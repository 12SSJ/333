import UIKit
import Capacitor

/**
 * Capacitor 的桥接控制器。这里只注册三个本地插件；
 * 状态栏隐藏与横竖屏方向统一由 Info.plist 控制，
 * 避免 override Capacitor 内部未开放（non-open）的属性。
 */
class AppViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GyDevicePlugin())
        bridge?.registerPluginInstance(GyHttpPlugin())
        bridge?.registerPluginInstance(GyImmersivePlugin())
    }
}
