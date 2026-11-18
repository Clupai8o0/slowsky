#!/usr/bin/env python3
"""Scrape NASA Space Apps 2026 data for the Melbourne local event.

Uses the site's public GraphQL API (the same one the website calls), so the
data is complete and needs no browser. Queries and fragments come from
gql_defs.json, which was pulled from the site's own JavaScript bundles.

Writes raw JSON to ../data/. Run build_docs.py afterwards for Markdown.

    python3 scraper/scrape.py            # full scrape
    python3 scraper/scrape.py --teams    # only refresh Melbourne teams
"""
import argparse
import http.client
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.spaceappschallenge.org/graphql"
SITE = "https://www.spaceappschallenge.org"
EVENT_PATH = "/2026/"
LOCAL_EVENT_PATH = "/2026/local-events/melbourne/"
LOCAL_EVENTS_INDEX_PATH = "/2026/local-events/"
CHALLENGES_INDEX_PATH = "/2026/challenges/"
PAST_WINNERS_PATH = "/2025/awards/global-winners/"
INFO_PATHS = ["/2026/find-a-team/", "/2026/space-agency-partners/", "/about/"]
PAGE_SIZE = 100
DELAY = 0.3  # seconds between calls, to be polite

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DEFS = json.loads((Path(__file__).resolve().parent / "gql_defs.json").read_text())

# Fields that need a login. The API errors on them for anonymous calls, so
# they are stripped from every query.
AUTH_ONLY = ["revisionMeta", "workflow", "eligibility", "joinRequests", "memberOnlyInfo"]


def build_query(name):
    """Return a query plus every fragment it spreads, resolved recursively.

    Login-only fields are stripped before looking for spreads, so fragments
    used only inside them are left out (the API rejects unused fragments).
    """
    root = public(DEFS[name])
    parts, seen, todo = [root], set(), [root]
    while todo:
        text = todo.pop()
        for frag in re.findall(r"\.\.\.\s*([A-Z]\w*)", text):
            if frag in seen:
                continue
            seen.add(frag)
            if frag not in DEFS:
                raise KeyError(f"fragment {frag} missing from gql_defs.json")
            body = public(DEFS[frag])
            parts.append(body)
            todo.append(body)
    return "\n".join(parts)


def public(text):
    for field in AUTH_ONLY:
        text = strip_field(text, field)
    return text


def strip_field(query, field):
    """Remove `field` (with its { ... } selection, if any) from a query."""
    out = []
    i = 0
    pattern = re.compile(r"(?<![\w.])" + field + r"(?!\w)")
    while True:
        m = pattern.search(query, i)
        if not m:
            out.append(query[i:])
            return "".join(out)
        out.append(query[i:m.start()])
        j = m.end()
        k = j
        while k < len(query) and query[k] in " \t\r\n":
            k += 1
        if k < len(query) and query[k] == "{":
            depth = 0
            while k < len(query):
                if query[k] == "{":
                    depth += 1
                elif query[k] == "}":
                    depth -= 1
                    if depth == 0:
                        k += 1
                        break
                k += 1
            j = k
        i = j


def gql(name, variables, retries=3):
    body = json.dumps({"operationName": name, "query": build_query(name), "variables": variables}).encode()
    req = urllib.request.Request(API, data=body, headers={
        "content-type": "application/json",
        "origin": SITE,
        "referer": SITE + "/",
        "user-agent": "Mozilla/5.0 (spaceapps-melbourne-2026 scraper)",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read())
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", "replace")[:500]
            if err.code < 500 or attempt == retries - 1:
                # 4xx means a bad query: retrying won't help, and the body says why.
                raise RuntimeError(f"{name}: HTTP {err.code}: {detail}") from err
            print(f"  retry {name}: HTTP {err.code}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
            continue
        except (urllib.error.URLError, ConnectionError, TimeoutError, http.client.HTTPException) as err:
            if attempt == retries - 1:
                raise
            print(f"  retry {name}: {err}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
            continue
        time.sleep(DELAY)
        data = payload.get("data")
        if payload.get("errors"):
            msgs = "; ".join(e.get("message", "?") for e in payload["errors"])
            if not data or any(v is None for v in data.values()):
                raise RuntimeError(f"{name}: {msgs}")
            print(f"  warn {name}: {msgs}", file=sys.stderr)
        return data


def paginate(name, key, variables):
    """Fetch every edge of a paginated connection."""
    nodes, after, total = [], "", None
    while True:
        data = gql(name, {**variables, "first": PAGE_SIZE, "after": after})[key]
        total = data.get("totalCount", total)
        nodes.extend(edge["node"] for edge in data["edges"])
        info = data.get("pageInfo") or {}
        if not info.get("hasNextPage") or not info.get("endCursor") or info["endCursor"] == after:
            break
        after = info["endCursor"]
    return nodes, total


def page(path):
    return gql("PageByPath", {"input": path})["pageByPath"]


def save(name, obj):
    DATA.mkdir(exist_ok=True)
    (DATA / f"{name}.json").write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    print(f"  wrote data/{name}.json")


def scrape_teams(local_event):
    event_id, location_id = local_event["event"], local_event["id"]
    teams, total = paginate("Teams", "teams", {"q": "", "filtering": [
        {"field": "event", "value": event_id, "compare": "id"},
        {"field": "location", "value": location_id, "compare": "id"},
    ]})
    print(f"  {len(teams)} Melbourne teams (API total {total})")
    return teams


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--teams", action="store_true", help="only refresh Melbourne teams")
    args = ap.parse_args()
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")

    print("Melbourne local event page")
    local_event = page(LOCAL_EVENT_PATH)
    if args.teams:
        teams = scrape_teams(local_event)
        save("teams", {"scrapedAt": started, "localEvent": local_event["id"], "teams": teams})
        return

    save("local_event", local_event)
    event_id = local_event["event"]

    print("Global event")
    event = gql("Event", {"id": event_id})["event"]
    save("event", event)
    save("event_home", page(EVENT_PATH))

    print("Melbourne teams")
    teams = scrape_teams(local_event)
    save("teams", {"scrapedAt": started, "localEvent": local_event["id"], "teams": teams})

    print("Challenges")
    save("challenges_index", page(CHALLENGES_INDEX_PATH))
    challenges, total = paginate("Challenges", "challenges", {"event": event_id, "q": "", "filtering": []})
    print(f"  {len(challenges)} challenges (API total {total})")
    for ch in challenges:
        detail = page(ch["meta"]["relativeUrl"])
        ch.update({k: detail.get(k) for k in ("detailsContent", "resourcesTabContent", "teamsTabContent")})
        ch["globalTeamCount"] = team_count(event_id, "challenge", ch["id"])
        ch["melbourneTeamCount"] = sum(1 for t in teams if t.get("challenge") == ch["id"])
        print(f"  - {ch['title']}: {ch['globalTeamCount']} teams worldwide")
    save("challenges", challenges)

    print("Local events index")
    save("local_events_index", page(LOCAL_EVENTS_INDEX_PATH))

    print("Guides and info pages")
    resources, _ = paginate("Resources", "resources", {"q": "", "filtering": []})
    guide_paths = sorted({r["page"]["meta"]["relativeUrl"] for r in resources if r.get("page")})
    guides = [page(p) for p in guide_paths]
    save("guides", guides)
    save("info_pages", [page(p) for p in INFO_PATHS])

    print("Past winners")
    winners = past_winners()
    save("past_winners", winners)

    save("scrape_meta", {
        "scrapedAt": started,
        "source": SITE + LOCAL_EVENT_PATH + "?tab=teams",
        "api": API,
        "counts": {
            "teams": len(teams),
            "challenges": len(challenges),
            "guides": len(guides),
            "pastWinners": sum(len(a["teams"]) for a in winners["awards"]),
        },
    })
    print("Done")


def past_winners():
    """Last year's global winners, with their projects, as a bar to aim for."""
    award_page = page(PAST_WINNERS_PATH)
    details = award_page["nominationDetails"]
    ids = sorted({tid for award in details["awards"] for tid in award.get("teams") or []})
    teams, _ = paginate("Teams", "teams", {"q": "", "filtering": [
        {"field": "ids", "value": ",".join(ids), "compare": "ids"},
    ]})
    # An award keeps its winners from every year, so keep only this page's event.
    by_id = {t["id"]: t for t in teams if t.get("event") == award_page["event"]}
    awards = [{
        "name": award["name"],
        "description": award.get("description"),
        "teams": [by_id[tid] for tid in award.get("teams") or [] if tid in by_id],
    } for award in details["awards"]]
    print(f"  {sum(len(a['teams']) for a in awards)} winning teams")
    return {"title": award_page["title"], "url": SITE + PAST_WINNERS_PATH, "awards": awards}


def team_count(event_id, field, value):
    """Return how many teams match one filter, without paging."""
    data = gql("Teams", {"first": 1, "after": "", "q": "", "filtering": [
        {"field": "event", "value": event_id, "compare": "id"},
        {"field": field, "value": value, "compare": "id"},
    ]})["teams"]
    return data.get("totalCount")


if __name__ == "__main__":
    main()
