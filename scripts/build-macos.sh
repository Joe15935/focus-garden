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
# A fixed local certificate keeps macOS privacy permissions (Accessibility,
# Automation) across rebuilds; without one, fall back to an ad-hoc signature.
# Create it once with scripts/create-local-signing.sh.
IDENTITY="-"
if security find-identity -p codesigning 2>/dev/null | grep -q '"Focus Garden Local Signing"'; then
  IDENTITY="Focus Garden Local Signing"
fi
echo "codesign identity: $IDENTITY"
codesign --force --deep --sign "$IDENTITY" --identifier org.focusgarden.local "target/release/bundle/macos/Focus Garden.app"
codesign --verify --deep --strict "target/release/bundle/macos/Focus Garden.app"
