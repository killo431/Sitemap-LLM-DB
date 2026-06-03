# Crawl Sitemap Generator

A Chrome extension for crawling websites and generating sitemaps with XML export functionality.

## Features

- **Website Crawling**: Automatically crawl websites and extract all internal links
- **Sitemap Generation**: Generate comprehensive sitemaps with page titles, descriptions, and metadata
- **XML Export**: Download sitemaps in standard XML format (sitename-sitemap.xml)
- **Flexible Options**:
  - Crawl entire domain or current directory only
  - Include/exclude subdomains
  - Skip similar URLs (experimental)
  - Handle async elements
  - Query parameter handling
  - Slow mode for reduced server load
  - Exclude specific directories with regex support

## Installation

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the repository folder

## Usage

1. Navigate to the website you want to crawl
2. Click the extension icon
3. Configure crawling options (optional)
4. Click "Start Crawling"
5. Wait for the crawl to complete
6. Click "Download XML Sitemap" to save the sitemap as an XML file

## XML Sitemap Format

The generated XML sitemap follows the standard sitemap protocol:
- Includes all non-404 pages
- Contains URL, last modified date, change frequency, and priority
- Filename format: `{site-name}-sitemap.xml`

Example:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2026-06-03</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>
```

## Options

- **Crawl Target**: Choose between entire domain or current directory and below
- **Subdomains**: Include or exclude different subdomains
- **Similar URLs**: Skip similar URLs (experimental feature)
- **Async Elements**: Fetch async content (slower but more complete)
- **URL Query**: Ignore or include query parameters
- **Slow Mode**: Add delays between requests to reduce server load
- **Exclude Directories**: Use regex patterns to exclude specific paths

## Version

Current version: 1.8

## Recent Updates

- Translated all UI elements from Japanese to English
- Added XML sitemap download functionality
- Improved sitemap naming convention (site-name-sitemap.xml)
- Enhanced user experience with clear download button

## License

This project is available for use and modification.
