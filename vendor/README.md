# Minimal swift-rs build compatibility patch

`swift-rs` 1.0.8 is copied from its crates.io source into `vendor/swift-rs`, with its original MIT and Apache-2.0 licenses retained. It is selected only through the workspace Cargo patch. The global Cargo registry, SDK and SwiftPM dependency sources are not edited.

## Scope

1. Standalone CommandLineTools can use SwiftPM's modern `out/Products/<Configuration>` layout even when `xcodebuild -version` is unavailable. `src-rs/build.rs` detects the actual static archive after Swift compilation and uses the existing modern path handling.
2. This toolchain also internalizes C exports in optimized static products. Mado's embedded `SwiftRs.o` defines the explicit `@_cdecl("retain_object")` and `@_cdecl("release_object")` functions which Rust calls to retain/drop Swift objects. Their release archive symbols were local `t`, causing undefined-symbol errors at final link. The helper now promotes only those two dependency symbols, only inside `SwiftRs.o` in the `Mado` product, and retains the existing unique-definition check. Other dependency symbols are not promoted. Existing handling of Mado's own C exports is unchanged.
3. If promotion is needed but `llvm-objcopy` is unavailable or fails, the helper stops with an actionable error instead of continuing to a confusing link failure.

## Prerequisite

Install the active Rust toolchain's LLVM tools with `rustup component add llvm-tools`. The macOS build script performs this idempotent prerequisite step. This installs developer tools only; LLVM tools are not bundled into or used by the running application.

The patch changes build output discovery and visibility of two already-declared C exports. It does not change Swift/Rust runtime function implementations, introduce a new app runtime dependency, promote every internal symbol, or relax SDK/system permissions.

Revisit/remove this patch when upstream handles the standalone toolchain and its embedded SwiftRs exports. Exact package versions, original licenses and patch hashes are recorded in `docs/licenses/inventory.json` and `THIRD_PARTY_NOTICES`.
