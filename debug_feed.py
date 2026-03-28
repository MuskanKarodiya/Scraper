
import urllib.request
import xml.etree.ElementTree as ET
import re

urls = [
    "https://bensbites.substack.com/feed",  # Ben's Bites Substack (backup)
    "https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml"  # Rundown AI
]

def parse_item(item):
    """Robust item parser that ignores namespaces."""
    def get_text(tag_suffix):
        # Find any child ending with tag_suffix (ignoring namespace)
        for child in item:
            if child.tag.endswith(tag_suffix):
                return child.text
        return None
    
    def get_attr(tag_suffix, attr):
        for child in item:
            if child.tag.endswith(tag_suffix):
                return child.get(attr)
        return None

    title = get_text("title")
    link = get_text("link") or get_attr("link", "href")
    
    # Description/Content
    desc = get_text("description") or ""
    content = get_text("encoded") or get_text("content") or ""
    full_text = desc + content
    
    # Image extraction
    thumbnail = None
    
    # 1. Check media:thumbnail / media:content
    for child in item:
        if child.tag.endswith("thumbnail") or child.tag.endswith("content"):
            url = child.get("url")
            if url and (url.endswith('.jpg') or url.endswith('.png') or 'image' in (child.get("type") or "")):
                thumbnail = url
                break
    
    # 2. Check enclosure
    if not thumbnail:
        enc_url = get_attr("enclosure", "url")
        enc_type = get_attr("enclosure", "type")
        if enc_url and ('image' in (enc_type or "") or enc_url.endswith(('.jpg', '.png', '.jpeg'))):
            thumbnail = enc_url

    # 3. Regex on content
    if not thumbnail:
        img_match = re.search(r'<img[^>]+src="([^">]+)"', full_text)
        if img_match:
            thumbnail = img_match.group(1)

    print(f"Title: {title}")
    print(f"Link: {link}")
    print(f"Thumbnail: {thumbnail}")
    print("-" * 20)

for url in urls:
    print(f"\n--- Checking {url} ---")
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; AINewz-Bot/1.0; +https://ainewz.ai)",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            xml_text = resp.read().decode("utf-8", errors="replace")
            print(f"Fetched {len(xml_text)} bytes")
            
            root = ET.fromstring(xml_text)
            
            # Find items
            items = []
            for elem in root.iter():
                if elem.tag.endswith("item") or elem.tag.endswith("entry"):
                    items.append(elem)
            
            print(f"Found {len(items)} items")
            if items:
                print("First 2 items:")
                for item in items[:2]:
                    parse_item(item)

    except Exception as e:
        print(f"Error: {e}")
