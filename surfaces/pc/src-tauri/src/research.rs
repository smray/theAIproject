// Academic research tool: searches CrossRef (the DOI registration agency's own public API -
// every real published journal article gets indexed there, which is a stronger "reputable
// source" guarantee than a general web search) for actual journal articles, filters out
// preprints/conference proceedings/components, and ranks by citation count as a quality signal.
// Verified against the real API (not assumed from docs) before writing this - see session notes.
//
// This is deliberately NOT a general web-search tool. It only returns journal-article-type
// records from CrossRef's index. It cannot verify methodological quality, replication status, or
// retraction - citation count is a proxy for influence, not correctness, and is stated as such
// in what gets returned to the model.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct PaperResult {
    pub title: String,
    pub authors: String,
    pub journal: String,
    pub year: Option<i64>,
    pub citation_count: i64,
    pub doi: String,
    pub url: String,
}

#[derive(Deserialize)]
struct CrossRefResponse {
    message: CrossRefMessage,
}

#[derive(Deserialize)]
struct CrossRefMessage {
    items: Vec<CrossRefItem>,
}

#[derive(Deserialize)]
struct CrossRefItem {
    title: Option<Vec<String>>,
    author: Option<Vec<CrossRefAuthor>>,
    #[serde(rename = "container-title")]
    container_title: Option<Vec<String>>,
    #[serde(rename = "is-referenced-by-count")]
    is_referenced_by_count: Option<i64>,
    #[serde(rename = "published")]
    published: Option<CrossRefDate>,
    #[serde(rename = "DOI")]
    doi: Option<String>,
    #[serde(rename = "type")]
    item_type: Option<String>,
}

#[derive(Deserialize)]
struct CrossRefAuthor {
    given: Option<String>,
    family: Option<String>,
}

#[derive(Deserialize)]
struct CrossRefDate {
    #[serde(rename = "date-parts")]
    date_parts: Option<Vec<Vec<i64>>>,
}

#[tauri::command]
pub async fn search_journal_articles(query: String, limit: u32) -> Result<Vec<PaperResult>, String> {
    let capped_limit = limit.min(20).max(1);
    // Over-fetch since we filter down to journal-article type client-side (CrossRef's own
    // `filter=type:journal-article` query param exists but over-fetching + local filtering keeps
    // this resilient to that param's exact syntax changing upstream).
    let url = format!(
        "https://api.crossref.org/works?query={}&rows={}&select=title,author,published,container-title,is-referenced-by-count,DOI,type&mailto=smith.mathewraymond@gmail.com",
        urlencoding_encode(&query),
        capped_limit * 3,
    );

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("CrossRef request failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("CrossRef returned HTTP {}", response.status()));
    }
    let body: CrossRefResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse CrossRef response: {}", e))?;

    let mut papers: Vec<PaperResult> = body
        .message
        .items
        .into_iter()
        .filter(|item| item.item_type.as_deref() == Some("journal-article"))
        .map(|item| {
            let title = item
                .title
                .and_then(|t| t.into_iter().next())
                .unwrap_or_else(|| "(untitled)".to_string());
            let authors = item
                .author
                .unwrap_or_default()
                .into_iter()
                .filter_map(|a| match (a.given, a.family) {
                    (Some(g), Some(f)) => Some(format!("{} {}", g, f)),
                    (None, Some(f)) => Some(f),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join(", ");
            let journal = item
                .container_title
                .and_then(|c| c.into_iter().next())
                .unwrap_or_default();
            let year = item
                .published
                .and_then(|p| p.date_parts)
                .and_then(|dp| dp.into_iter().next())
                .and_then(|parts| parts.into_iter().next());
            let citation_count = item.is_referenced_by_count.unwrap_or(0);
            let doi = item.doi.unwrap_or_default();
            let url = if doi.is_empty() {
                String::new()
            } else {
                format!("https://doi.org/{}", doi)
            };
            PaperResult {
                title,
                authors,
                journal,
                year,
                citation_count,
                doi,
                url,
            }
        })
        .collect();

    // Quality ranking: citation count, descending. A blunt but real signal - not a substitute
    // for actually reading the paper, and stated as such wherever this feeds back to the model.
    papers.sort_by(|a, b| b.citation_count.cmp(&a.citation_count));
    papers.truncate(capped_limit as usize);

    Ok(papers)
}

fn urlencoding_encode(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '~' {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect()
}
