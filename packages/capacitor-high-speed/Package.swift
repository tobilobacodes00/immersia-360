// swift-tools-version: 5.9
import PackageDescription

// The package and product names are what the Capacitor CLI derives from the npm name
// (@immersia/capacitor-high-speed -> ImmersiaCapacitorHighSpeed); `cap sync` writes them into the
// app's CapApp-SPM package, so they must not be renamed on their own.
let package = Package(
    name: "ImmersiaCapacitorHighSpeed",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "ImmersiaCapacitorHighSpeed",
            targets: ["HighSpeedPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "HighSpeedPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/HighSpeedPlugin")
    ]
)
