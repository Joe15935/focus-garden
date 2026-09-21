#!/bin/zsh
set -eu
cd "${0:A:h:h}"
# Use the installed command-line SDK without changing the user's Xcode selection.
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
export MACOSX_DEPLOYMENT_TARGET=13.0
# Modern SwiftPM static products need llvm-objcopy for their explicit C exports.
rustup component add llvm-tools
cd crates/focuser-ui/frontend
npm ci
npm run build
cd ..
npx --yes @tauri-apps/cli@2.10.1 build --bundles app

cd ../..
codesign --force --deep --sign - --identifier org.focusgarden.local "target/release/bundle/macos/Focus Garden.app"
codesign --verify --deep --strict "target/release/bundle/macos/Focus Garden.app"
