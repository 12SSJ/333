import Foundation
import UIKit
import CryptoKit
import Security
import Capacitor

/* ---------------- 设备机器码与注册激活 ----------------
   机器码 = SHA-256(机型 | 线程数 | 物理内存 | IDFV | Keychain 种子) 前 16 位。
   注册码算法与安卓/电脑版一致：SHA-256(机器码 | 固定密钥) 前 16 位。
   IDFV 在卸载 App 后会变化，因此额外生成一个随机种子存进 Keychain，
   保证同一台设备重装后机器码依然稳定。 */

@objc(GyDevicePlugin)
public class GyDevicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GyDevicePlugin"
    public let jsName = "GyDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getActivationState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "activate", returnType: CAPPluginReturnPromise)
    ]

    private let secret = "JGY-2026-MOONLIGHT"
    private let defaultsKey = "gy_license_code"
    private let keychainService = "com.guangying.yueying.machine"
    private let keychainAccount = "machine_seed"

    private struct MachineInfo {
        let code: String
        let cpu: String
        let memoryGb: Double
        let brand: String
    }

    @objc func getActivationState(_ call: CAPPluginCall) {
        let info = machineInfo()
        let saved = UserDefaults.standard.string(forKey: defaultsKey) ?? ""
        let expected = expectedCode(machine: info.code)
        let activated = !saved.isEmpty && normalize(saved) == normalize(expected)
        call.resolve([
            "activated": activated,
            "code": info.code,
            "cpu": info.cpu,
            "cores": ProcessInfo.processInfo.processorCount,
            "memoryGb": String(format: "%.1f", info.memoryGb),
            "brand": info.brand
        ])
    }

    @objc func activate(_ call: CAPPluginCall) {
        let input = normalize(call.getString("code") ?? "")
        if input.isEmpty {
            call.reject("请输入注册码")
            return
        }
        let info = machineInfo()
        let expected = normalize(expectedCode(machine: info.code))
        if input != expected {
            call.reject("注册码不正确，请核对机器码后重新获取")
            return
        }
        UserDefaults.standard.set(input, forKey: defaultsKey)
        call.resolve(["activated": true])
    }

    /* ---------------- 机器码 ---------------- */

    private func machineInfo() -> MachineInfo {
        let machine = hardwareModel()
        let memory = Double(ProcessInfo.processInfo.physicalMemory) / 1024.0 / 1024.0 / 1024.0
        let idfv = UIDevice.current.identifierForVendor?.uuidString ?? "no-idfv"
        let raw = [
            machine,
            String(ProcessInfo.processInfo.processorCount),
            String(ProcessInfo.processInfo.physicalMemory),
            idfv,
            machineSeed()
        ].joined(separator: "|")
        let code = formatCode(String(sha256Hex(raw).prefix(16)))
        return MachineInfo(
            code: code,
            cpu: machine,
            memoryGb: memory,
            brand: "\(UIDevice.current.model) · iOS \(UIDevice.current.systemVersion)"
        )
    }

    private func hardwareModel() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let mirror = Mirror(reflecting: systemInfo.machine)
        let model = mirror.children.reduce(into: "") { result, element in
            guard let value = element.value as? Int8, value != 0 else { return }
            result.append(Character(UnicodeScalar(UInt8(value))))
        }
        return model.isEmpty ? "iphone" : model
    }

    /* ---------------- Keychain 种子 ---------------- */

    private func machineSeed() -> String {
        if let seed = keychainValue() { return seed }
        let seed = UUID().uuidString
        keychainSet(seed)
        return seed
    }

    private func keychainValue() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func keychainSet(_ value: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount
        ]
        SecItemDelete(query as CFDictionary)
        var attributes = query
        attributes[kSecValueData as String] = Data(value.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock as String
        SecItemAdd(attributes as CFDictionary, nil)
    }

    /* ---------------- 授权算法 ---------------- */

    private func expectedCode(machine: String) -> String {
        formatCode(String(sha256Hex(normalize(machine) + "|" + secret).prefix(16)))
    }

    private func normalize(_ value: String) -> String {
        value.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    private func formatCode(_ hex: String) -> String {
        let upper = hex.uppercased()
        guard upper.count >= 16 else { return upper }
        let chars = Array(upper)
        return "\(String(chars[0..<4]))-\(String(chars[4..<8]))-\(String(chars[8..<12]))-\(String(chars[12..<16]))"
    }

    private func sha256Hex(_ text: String) -> String {
        let digest = SHA256.hash(data: Data(text.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

/* ---------------- 原生 GET 请求 ----------------
   音乐接口需要 Referer / Origin，WebView 的 fetch 会丢掉这些受限请求头，
   这里用 URLSession 发原生请求，返回 Base64 字节给前端。 */

@objc(GyHttpPlugin)
public class GyHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GyHttpPlugin"
    public let jsName = "GyHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise)
    ]

    @objc func get(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("缺少 url")
            return
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.httpMethod = "GET"
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let headers = call.getObject("headers") ?? [:]
        for (key, value) in headers {
            if let text = value as? String {
                request.setValue(text, forHTTPHeaderField: key)
            }
        }
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            call.resolve([
                "status": status,
                "contentType": response?.mimeType ?? "",
                "data": (data ?? Data()).base64EncodedString()
            ])
        }.resume()
    }
}

/* ---------------- 沉浸式全屏 / 退出 ----------------
   iOS 没有安卓的系统栏概念，这里通过自定义 ViewController 隐藏状态栏
   和底部 Home 指示条，播放时让画面铺满整块屏幕。 */

@objc(GyImmersivePlugin)
public class GyImmersivePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GyImmersivePlugin"
    public let jsName = "Immersive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestFullscreenWindow", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exitApp", returnType: CAPPluginReturnPromise)
    ]

    static var immersive = false

    @objc func setEnabled(_ call: CAPPluginCall) {
        GyImmersivePlugin.immersive = call.getBool("enabled") ?? false
        DispatchQueue.main.async {
            self.bridge?.viewController?.setNeedsStatusBarAppearanceUpdate()
            self.bridge?.viewController?.setNeedsUpdateOfHomeIndicatorAutoHidden()
            call.resolve()
        }
    }

    @objc func requestFullscreenWindow(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func exitApp(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            exit(0)
        }
        call.resolve()
    }
}
