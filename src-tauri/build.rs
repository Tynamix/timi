fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        panic!("timi requires macOS 13 or later");
    }
    println!("cargo:rerun-if-changed=../dist-native/backend.js");
    for source in ["native/engine.m", "native/platform.m"] {
        println!("cargo:rerun-if-changed={source}");
    }
    cc::Build::new()
        .files(["native/engine.m", "native/platform.m"])
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .flag("-Wno-unused-parameter")
        .flag("-mmacosx-version-min=13.0")
        .compile("timi_native");
    for framework in [
        "Foundation",
        "AppKit",
        "QuartzCore",
        "JavaScriptCore",
        "WebKit",
        "ApplicationServices",
        "ServiceManagement",
        "UserNotifications",
        "IOKit",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    println!("cargo:rustc-link-lib=sqlite3");
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["desktop"])),
    )
    .expect("Tauri build configuration");
}
