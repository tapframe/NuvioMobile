import Expo
// @generated begin react-native-google-cast-import - expo prebuild (DO NOT MODIFY) sync-4cd300bca26a1d1fcc83f4baf37b0e62afcc1867
#if canImport(GoogleCast) && os(iOS)
import GoogleCast
#endif
// @generated end react-native-google-cast-import
import React
import ReactAppDependencyProvider
import Network

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
// @generated begin react-native-google-cast-didFinishLaunchingWithOptions - expo prebuild (DO NOT MODIFY) sync-3f476aa248b3451597781fe1ea72c7d4127ed7f9
#if canImport(GoogleCast) && os(iOS)
    let receiverAppID = "CC1AD845"
    let criteria = GCKDiscoveryCriteria(applicationID: receiverAppID)
    let options = GCKCastOptions(discoveryCriteria: criteria)
    options.disableDiscoveryAutostart = false
    options.startDiscoveryAfterFirstTapOnCastButton = true
    options.suspendSessionsWhenBackgrounded = true
    GCKCastContext.setSharedInstanceWith(options)
    GCKCastContext.sharedInstance().useDefaultExpandedMediaControls = true
#endif
// @generated end react-native-google-cast-didFinishLaunchingWithOptions
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }

  func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    RNBackgroundDownloader.setCompletionHandlerWithIdentifier(identifier, completionHandler: completionHandler)
  }

}

private struct IOSDoHConfig {
  static let modeOff = "off"
  static let modeAuto = "auto"
  static let modeStrict = "strict"

  static let providerCloudflare = "cloudflare"
  static let providerGoogle = "google"
  static let providerQuad9 = "quad9"
  static let providerCustom = "custom"

  let enabled: Bool
  let mode: String
  let provider: String
  let customUrl: String

  static func normalized(from raw: [String: Any]) -> IOSDoHConfig {
    let requestedEnabled = (raw["enabled"] as? Bool) ?? false
    let requestedMode = ((raw["mode"] as? String) ?? modeOff).lowercased()
    let requestedProvider = ((raw["provider"] as? String) ?? providerCloudflare).lowercased()
    let requestedCustomUrl = ((raw["customUrl"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

    let normalizedMode: String
    switch requestedMode {
    case modeAuto, modeStrict:
      normalizedMode = requestedMode
    default:
      normalizedMode = modeOff
    }

    let normalizedProvider: String
    switch requestedProvider {
    case providerCloudflare, providerGoogle, providerQuad9, providerCustom:
      normalizedProvider = requestedProvider
    default:
      normalizedProvider = providerCloudflare
    }

    let enabled = requestedEnabled && normalizedMode != modeOff

    return IOSDoHConfig(
      enabled: enabled,
      mode: enabled ? normalizedMode : modeOff,
      provider: normalizedProvider,
      customUrl: normalizedProvider == providerCustom ? requestedCustomUrl : ""
    )
  }

  var resolverURL: URL? {
    switch provider {
    case IOSDoHConfig.providerCloudflare:
      return URL(string: "https://cloudflare-dns.com/dns-query")
    case IOSDoHConfig.providerGoogle:
      return URL(string: "https://dns.google/dns-query")
    case IOSDoHConfig.providerQuad9:
      return URL(string: "https://dns.quad9.net/dns-query")
    case IOSDoHConfig.providerCustom:
      guard let candidate = URL(string: customUrl), candidate.scheme?.lowercased() == "https" else {
        return nil
      }
      return candidate
    default:
      return nil
    }
  }

  var asDictionary: [String: Any] {
    [
      "enabled": enabled,
      "mode": mode,
      "provider": provider,
      "customUrl": customUrl,
    ]
  }
}

private final class IOSDoHState {
  static let shared = IOSDoHState()

  private let lock = NSLock()
  private var config = IOSDoHConfig.normalized(from: [:])

  func apply(_ nextConfig: IOSDoHConfig) {
    lock.lock()
    config = nextConfig
    lock.unlock()
    applyToNetworkStack(nextConfig)
  }

  func current() -> IOSDoHConfig {
    lock.lock()
    defer { lock.unlock() }
    return config
  }

  private func applyToNetworkStack(_ config: IOSDoHConfig) {
    if #available(iOS 14.0, *) {
      let privacyContext = NWParameters.PrivacyContext.default
      if !config.enabled || config.mode == IOSDoHConfig.modeOff {
        privacyContext.requireEncryptedNameResolution(false, fallbackResolver: nil)
        return
      }

      // Keep AUTO mode resilient: if custom URL is invalid, fall back to system DNS.
      if config.mode == IOSDoHConfig.modeAuto, config.resolverURL == nil {
        privacyContext.requireEncryptedNameResolution(false, fallbackResolver: nil)
        return
      }

      let fallbackURL: URL? = config.mode == IOSDoHConfig.modeAuto ? config.resolverURL : nil
      privacyContext.requireEncryptedNameResolution(true, fallbackResolver: fallbackURL)
    }
  }
}

@objc(NetworkPrivacyModule)
class NetworkPrivacyModule: NSObject, RCTBridgeModule {
  static func moduleName() -> String! {
    "NetworkPrivacyModule"
  }

  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(applyDohConfig:resolver:rejecter:)
  func applyDohConfig(
    _ configMap: NSDictionary,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard let rawConfig = configMap as? [String: Any] else {
      reject("DOH_INVALID_PAYLOAD", "Invalid DoH configuration payload", nil)
      return
    }

    let normalized = IOSDoHConfig.normalized(from: rawConfig)
    IOSDoHState.shared.apply(normalized)
    resolve(nil)
  }

  @objc(getDohConfig:rejecter:)
  func getDohConfig(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(IOSDoHState.shared.current().asDictionary)
  }
}
