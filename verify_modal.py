
import urllib.request
import json

url = "https://muskankarodiya06o--ainewz-scraper-get-articles.modal.run"

print(f"Fetching from {url}...")
try:
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.load(resp)
        articles = data.get("articles", [])
        print(f"Got {len(articles)} articles.")
        
        missing_titles = [a for a in articles if not a.get("title") or a["title"] == "Untitled"]
        missing_links = [a for a in articles if not a.get("url") or a["url"] == "#"]
        missing_thumbs = [a for a in articles if not a.get("thumbnail")]
        
        print("\n--- Summary ---")
        print(f"Types: {set(a['source'] for a in articles)}")
        print(f"Missing Titles: {len(missing_titles)}")
        print(f"Broken Links: {len(missing_links)}")
        print(f"Missing Thumbnails: {len(missing_thumbs)}")
        
        if missing_titles:
            print("\nExample Missing Title:", missing_titles[0])
        else:
            print("\n✅ All titles present!")
            
        if missing_links:
            print("\nExample Broken Link:", missing_links[0])
        else:
            print("\n✅ All links valid!")

        if missing_thumbs:
            print(f"\nExample Missing Thumbnail (total {len(missing_thumbs)}):", missing_thumbs[0]['title'])
        else:
            print("\n✅ All thumbnails present!")

except Exception as e:
    print(f"Error: {e}")
