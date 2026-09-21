#!/bin/zsh
set -eu
cd "${0:A:h:h}"
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
export MACOSX_DEPLOYMENT_TARGET=13.0
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
cd crates/focuser-ui/frontend
npm run typecheck
npm test
npm run build
