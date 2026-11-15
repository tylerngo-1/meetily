//! Text snippets around a search match, for showing search results.
//!
//! Works on characters, not bytes: slicing a UTF-8 string at byte offsets near a match panics
//! when the cut falls inside a multi-byte character (common in Vietnamese text).

/// Up to `radius` characters on each side of the first case-insensitive match of `query`,
/// with "..." where text was cut. Newlines become spaces. Falls back to the start of `text`
/// when there is no match.
pub fn match_snippet(text: &str, query: &str, radius: usize) -> String {
    let chars: Vec<char> = text.chars().map(|c| if c == '\n' || c == '\r' { ' ' } else { c }).collect();
    // One lowercase char per original char, so indexes line up with `chars`.
    let fold = |c: char| c.to_lowercase().next().unwrap_or(c);
    let lower: Vec<char> = chars.iter().map(|&c| fold(c)).collect();
    let needle: Vec<char> = query.trim().chars().map(fold).collect();

    let found = if needle.is_empty() || needle.len() > lower.len() {
        None
    } else {
        (0..=lower.len() - needle.len()).find(|&i| lower[i..i + needle.len()] == needle[..])
    };

    let (start, end) = match found {
        Some(i) => (i.saturating_sub(radius), (i + needle.len() + radius).min(chars.len())),
        None => (0, (2 * radius).min(chars.len())),
    };

    let mut out = String::new();
    if start > 0 {
        out.push_str("...");
    }
    out.extend(&chars[start..end]);
    if end < chars.len() {
        out.push_str("...");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuts_on_character_boundaries_in_vietnamese_text() {
        let text = "Chúng ta sẽ chốt phạm vi xuất PDF vào thứ Sáu, anh An phụ trách backend";
        let snippet = match_snippet(text, "pdf", 10);
        assert_eq!(snippet, "...m vi xuất PDF vào thứ S...");
    }

    #[test]
    fn matches_case_insensitively_and_flattens_newlines() {
        assert_eq!(match_snippet("# Scope\n- PDF export", "scope", 50), "# Scope - PDF export");
    }

    #[test]
    fn falls_back_to_the_start_without_a_match() {
        assert_eq!(match_snippet("abcdef", "zzz", 2), "abcd...");
        assert_eq!(match_snippet("", "x", 5), "");
    }
}
