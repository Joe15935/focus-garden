//! The starter category lists exist twice on purpose.
//!
//! The desktop frontend fetches its copy at runtime; the extension bundles its
//! own so `extension/` builds without the rest of the repo. AMO requires a
//! source archive a reviewer can build, and reaching across to `../crates/`
//! made that impossible.
//!
//! Their rule data must stay identical. Focus Garden translates only the app's
//! display names and descriptions; those labels intentionally differ.

use std::path::PathBuf;

fn repo_file(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

#[test]
fn starter_lists_match() {
    let app = repo_file("crates/focuser-ui/frontend/public/premade-lists.json");
    let extension = repo_file("extension/public/premade-lists.json");

    let app_json = std::fs::read_to_string(&app).expect("the app's starter lists are missing");
    let extension_json =
        std::fs::read_to_string(&extension).expect("the extension's starter lists are missing");

    // Parsed rather than compared byte for byte, so a line ending or a trailing
    // newline is not a failing test.
    let mut app_value: serde_json::Value =
        serde_json::from_str(&app_json).expect("app copy is not JSON");
    let mut extension_value: serde_json::Value =
        serde_json::from_str(&extension_json).expect("extension copy is not JSON");

    // Only display labels may differ. Remove them from both copies after
    // checking their shape and the app's Chinese translation. The full-value
    // comparison below still checks category IDs, version, every domain and
    // wildcard (including array order), and any future non-display fields.
    for (value, chinese) in [(&mut app_value, true), (&mut extension_value, false)] {
        let categories = value["categories"]
            .as_object_mut()
            .expect("starter list categories must be an object");
        assert!(!categories.is_empty(), "starter list categories are empty");
        for (id, category) in categories {
            let fields = category
                .as_object_mut()
                .expect("starter list category must be an object");
            for field in ["name", "description"] {
                let label = fields
                    .remove(field)
                    .expect("starter list display label is missing");
                let label = label
                    .as_str()
                    .expect("starter list display label must be a string");
                assert!(!label.trim().is_empty(), "{id}.{field} must not be empty");
                if chinese {
                    assert!(
                        label
                            .chars()
                            .any(|c| ('\u{3400}'..='\u{9fff}').contains(&c)),
                        "{id}.{field} must contain a Chinese translation"
                    );
                }
            }
        }
    }

    assert_eq!(
        app_value, extension_value,
        "starter list rule data has drifted; only name and description may be translated"
    );
}
