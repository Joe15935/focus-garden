#!/bin/zsh
# Creates a self-signed code-signing certificate "Focus Garden Local Signing"
# in your login keychain, valid for 10 years, trusted only for code signing.
# Signing every build with the same certificate means macOS keeps the
# Accessibility / Automation permissions you granted, instead of asking again
# after each rebuild. Nothing is uploaded; no Apple developer account needed.
#
# Remove later: Keychain Access → login → My Certificates → delete
# "Focus Garden Local Signing".
set -eu
NAME="Focus Garden Local Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
if security find-identity -p codesigning | grep -q "\"$NAME\""; then
  echo "已存在：$NAME"
  exit 0
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cert.cnf" <<CNF
[ req ]
distinguished_name = dn
x509_extensions = ext
prompt = no
[ dn ]
CN = $NAME
[ ext ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
CNF
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cert.cnf" >/dev/null 2>&1
PASS="$(/usr/bin/openssl rand -hex 16)"
/usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -name "$NAME" -out "$TMP/identity.p12" -passout "pass:$PASS" >/dev/null 2>&1
security import "$TMP/identity.p12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign >/dev/null
# User-level trust for code signing only; macOS asks for your password to confirm.
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$TMP/cert.pem"
security find-identity -p codesigning | grep "\"$NAME\"" && echo "已创建：$NAME"
