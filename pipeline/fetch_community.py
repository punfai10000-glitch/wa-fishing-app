"""Weekly: find public Reddit discussions about fishing/spearfishing near each area.

Stores ONLY the post title, subreddit, date and link (no post text, no usernames), so the app can show
"Community talk (unverified)". Requires a free Reddit "script" app; put its id/secret in the repo's
Actions secrets as REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET. Without them this script does nothing.
Facebook groups are NOT included: Facebook offers no public API for group posts and forbids scraping.
"""
import base64, json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

AREAS = ["Cottesloe", "Fremantle", "Rockingham", "Mandurah", "Dawesville", "Bunbury", "Busselton", "Dunsborough",
         "Yallingup", "Margaret River", "Gracetown", "Augusta", "Hamelin Bay", "Windy Harbour", "Walpole", "Denmark WA",
         "Albany", "Bremer Bay", "Hopetoun", "Esperance"]
KEYWORDS = ("fish", "spear", "salmon", "herring", "tailor", "whiting", "snapper", "dhufish", "squid", "skippy", "bream", "mulloway", "jetty", "groper")
UA = "wa-fishing-intelligence/0.4 (weekly community links; contact via GitHub)"


def token(cid, secret):
    req = urllib.request.Request("https://www.reddit.com/api/v1/access_token", data=b"grant_type=client_credentials",
                                 headers={"User-Agent": UA, "Authorization": "Basic " + base64.b64encode(f"{cid}:{secret}".encode()).decode()})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def search(tok, q):
    url = "https://oauth.reddit.com/search?" + urllib.parse.urlencode({"q": q, "sort": "new", "limit": 25, "t": "all", "type": "link"})
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Authorization": f"bearer {tok}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["data"]["children"]


def main(out_path):
    cid, secret = os.environ.get("REDDIT_CLIENT_ID"), os.environ.get("REDDIT_CLIENT_SECRET")
    if not cid or not secret:
        print("No Reddit credentials — skipping"); return
    tok = token(cid, secret)
    result = {}
    for area in AREAS:
        posts = []
        for q in (f'"{area}" fishing', f'"{area}" spearfishing'):
            try:
                for c in search(tok, q):
                    d = c["data"]
                    title = d.get("title", "")
                    if not any(k in title.lower() for k in KEYWORDS) or d.get("over_18"):
                        continue
                    posts.append({"title": title[:160], "subreddit": d.get("subreddit"), "date": datetime.fromtimestamp(d["created_utc"], timezone.utc).date().isoformat(),
                                  "month": datetime.fromtimestamp(d["created_utc"], timezone.utc).month, "url": "https://www.reddit.com" + d.get("permalink", "")})
            except Exception as ex:
                print("search failed", area, ex)
            time.sleep(1.2)  # stay well under Reddit's rate limit
        seen, uniq = set(), []
        for p in sorted(posts, key=lambda x: x["date"], reverse=True):
            if p["url"] not in seen:
                seen.add(p["url"]); uniq.append(p)
        result[area.replace(" WA", "")] = uniq[:15]
        print(area, len(uniq))
    with open(out_path, "w") as f:
        json.dump({"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "Reddit (public posts; titles and links only)", "type": "community, unverified", "areas": result}, f, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/community.json")
