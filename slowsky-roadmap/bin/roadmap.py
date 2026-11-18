#!/usr/bin/env python3
"""Slowsky roadmap CLI: read the build roadmap and post progress updates.

Config: ~/.config/slowsky-roadmap/config.json  {"url": "https://...", "key": "..."}
        or env SLOWSKY_ROADMAP_URL and SLOWSKY_ROADMAP_KEY (env wins).
Author: --author, else env ROADMAP_AUTHOR, else "claude".

Examples:
  roadmap.py status                         countdown, what is on now, what is late
  roadmap.py list --kind feature --version v0.1
  roadmap.py show f-s3
  roadmap.py update f-s3 --status doing --progress 40 --note "header test passes"
  roadmap.py update f-s3 --status done --note "gate passed: sum within 1e-4 of astropy"
  roadmap.py note "Codex quota probe OK on both logins"
  roadmap.py add r-sound idea "Sonified light curves" --version beyond --tier roadmap
  roadmap.py add f-s3 feature "S3 range reader" --due 2026-11-14T13:00
                                            edit: only the fields you give change
  roadmap.py add --file items.json          a list of items, or {"items": [...]}
Times with no zone are NPT (+05:45).
Add --json to list, show or status for machine-readable output.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

CONFIG = os.path.expanduser('~/.config/slowsky-roadmap/config.json')
NPT = timezone(timedelta(hours=5, minutes=45))
LAST_SUBMIT = datetime(2026, 11, 15, 12, 30, tzinfo=NPT)
HARD_STOP = datetime(2026, 11, 15, 13, 0, tzinfo=NPT)
ICONS = {'todo': 'o', 'doing': '>', 'done': '+', 'blocked': 'x', 'cut': '-', 'late': '!'}
STATUSES = ['todo', 'doing', 'done', 'blocked', 'cut']
KINDS = ['version', 'feature', 'block', 'milestone', 'step', 'idea']
TIERS = ['core', 'weekend', 'if-ahead', 'roadmap']


def config():
    data = {}
    if os.path.exists(CONFIG):
        with open(CONFIG, encoding='utf-8') as fh:
            data = json.load(fh)
    url = os.environ.get('SLOWSKY_ROADMAP_URL') or data.get('url')
    key = os.environ.get('SLOWSKY_ROADMAP_KEY') or data.get('key')
    if not url or not key:
        sys.exit(f'No roadmap config. Write {CONFIG} with "url" and "key", or set SLOWSKY_ROADMAP_URL and SLOWSKY_ROADMAP_KEY.')
    return url.rstrip('/'), key


class NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib would resend the Authorization header to wherever a redirect points.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, f'refused a redirect to {newurl}', headers, fp)


OPENER = urllib.request.build_opener(NoRedirect)


def call(path, body=None):
    url, key = config()
    parts = urllib.parse.urlsplit(url)
    local = parts.scheme == 'http' and parts.hostname in ('127.0.0.1', 'localhost', '::1') and '@' not in parts.netloc
    if not ((parts.scheme == 'https' and parts.hostname and '@' not in parts.netloc) or local):
        sys.exit('The roadmap URL must use https:// (the key is sent with every call).')
    data = None if body is None else json.dumps(body).encode('utf-8')
    req = urllib.request.Request(f'{url}/api/{path}', data=data, method='GET' if body is None else 'POST')
    req.add_header('Authorization', f'Bearer {key}')
    req.add_header('User-Agent', 'slowsky-roadmap-cli/1')
    if body is not None:
        req.add_header('Content-Type', 'application/json')
    try:
        with OPENER.open(req, timeout=30) as res:
            return json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as err:
        try:
            message = json.loads(err.read().decode('utf-8')).get('error', '')
        except (ValueError, AttributeError):
            message = ''
        sys.exit(f'Roadmap API error {err.code}: {message or err.reason}')
    except urllib.error.URLError as err:
        sys.exit(f'Could not reach the roadmap: {err.reason}')


def when(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def npt(value):
    t = when(value)
    return t.astimezone(NPT).strftime('%a %H:%M') if t else ''


def span(delta):
    mins = int(abs(delta.total_seconds()) // 60)
    hrs, mins = divmod(mins, 60)
    return f'{hrs} h {mins:02d} m' if hrs else f'{mins} m'


def shown(item, now):
    st = item['status']
    if st in ('done', 'cut', 'blocked') or item['kind'] in ('milestone', 'idea', 'version') or item.get('lane') == 'rest':
        return st
    due = when(item.get('due_at'))
    return 'late' if due and due < now else st


def author(args):
    return args.author or os.environ.get('ROADMAP_AUTHOR') or 'claude'


def cmd_list(args):
    data = call('roadmap')
    now = datetime.now(timezone.utc)
    items = data['items']
    if args.kind:
        items = [i for i in items if i['kind'] == args.kind]
    if args.version:
        items = [i for i in items if i.get('version') == args.version]
    if args.status:
        items = [i for i in items if shown(i, now) == args.status]
    if args.json:
        print(json.dumps(items, indent=2))
        return
    for i in items:
        st = shown(i, now)
        due = npt(i.get('due_at'))
        print(f"{ICONS.get(st, '?')} {st:<7} {i['progress']:>3}%  {i['id']:<14} {i['title'][:60]:<60}  {due}")
    print(f'{len(items)} items. Times NPT.')


def cmd_show(args):
    data = call('roadmap')
    item = next((i for i in data['items'] if i['id'] == args.id), None)
    if item is None:
        sys.exit(f'No item {args.id}')
    history = [u for u in data['updates'] if u['item_id'] == args.id]
    if args.json:
        print(json.dumps({'item': item, 'updates': history}, indent=2))
        return
    now = datetime.now(timezone.utc)
    print(f"{item['id']}: {item['title']}")
    print(f"  {item['kind']}  version {item.get('version') or '-'}  tier {item.get('tier') or '-'}  owner {item.get('owner') or '-'}")
    span_text = f"{npt(item.get('start_at'))} to {npt(item.get('due_at'))}" if item.get('start_at') else f"due {npt(item.get('due_at')) or '-'}"
    print(f"  {span_text} NPT   status {shown(item, now)}  progress {item['progress']}%")
    if item.get('detail'):
        print(f"  {item['detail']}")
    if item.get('gate'):
        print(f"  Gate: {item['gate']}")
    if len(data['updates']) >= (data.get('updates_limit') or 10**9):
        print(f"  (only the newest {data['updates_limit']} updates load; older history may be missing)")
    for u in history:
        change = ' '.join(x for x in [u.get('status') or '', f"{u['progress']}%" if u.get('progress') is not None else ''] if x)
        print(f"  - {npt(u['at'])} {u['author']}: {u['note']}{f'  [{change}]' if change else ''}")


def cmd_status(args):
    data = call('roadmap')
    now = datetime.now(timezone.utc)
    items = data['items']
    on_now = [i for i in items if i['kind'] == 'block' and i.get('lane') != 'rest'
              and when(i.get('start_at')) and when(i.get('due_at'))
              and when(i['start_at']) <= now < when(i['due_at'])]
    late = [i for i in items if shown(i, now) == 'late']
    doing = [i for i in items if i['status'] == 'doing' and i['kind'] != 'block']
    upcoming = sorted((i for i in items if i['kind'] == 'milestone' and i['status'] != 'done'
                       and when(i.get('due_at')) and when(i['due_at']) > now), key=lambda i: i['due_at'])
    core = [i for i in items if i['kind'] == 'feature' and i.get('tier') == 'core' and i['status'] != 'cut']
    pct = round(sum(i['progress'] for i in core) / len(core)) if core else 0
    if args.json:
        print(json.dumps({'now': data['now'], 'core_progress': pct, 'on_now': on_now, 'doing': doing,
                          'late': late, 'next_milestone': upcoming[0] if upcoming else None}, indent=2))
        return
    left = LAST_SUBMIT - now
    print(f"Last Submit {'in ' + span(left) if left.total_seconds() > 0 else 'passed'} (Sun 12:30 NPT). Hard stop 13:00 NPT.")
    if upcoming:
        print(f"Next milestone: {upcoming[0]['title']} in {span(when(upcoming[0]['due_at']) - now)}")
    print(f'Core features: {pct}% ({sum(1 for i in core if i["status"] == "done")} of {len(core)} done)')
    for label, group in (('On the plan now', on_now), ('Doing', doing), ('Late', late)):
        if group:
            print(f'{label}:')
            for i in group:
                print(f"  {i['id']:<14} {i['title'][:70]}  ({i['progress']}%, due {npt(i.get('due_at'))} NPT)")


def cmd_update(args):
    if args.note is None and args.status is None and args.progress is None:
        sys.exit('Give --note, --status or --progress.')
    note = args.note
    if not note:
        bits = [args.status or '', f'{args.progress}%' if args.progress is not None else '']
        note = ', '.join(b for b in bits if b)
    body = {'id': args.id, 'note': note, 'author': author(args)}
    if args.status:
        body['status'] = args.status
    if args.progress is not None:
        body['progress'] = args.progress
    res = call('update', body)
    item = res.get('item') or {}
    print(f"Logged on {args.id}: {item.get('status', '?')} {item.get('progress', '?')}%")


def cmd_note(args):
    call('update', {'note': args.text, 'author': author(args)})
    print('Logged.')


def cmd_add(args):
    if args.file:
        with open(args.file, encoding='utf-8') as fh:
            data = json.load(fh)
        items = data['items'] if isinstance(data, dict) else data
    else:
        if not (args.id and args.kind and args.title):
            sys.exit('Give ID KIND TITLE, or --file.')
        item = {'id': args.id, 'kind': args.kind, 'title': args.title}
        for field in ('detail', 'version', 'tier', 'lane', 'owner', 'gate', 'sort'):
            value = getattr(args, field)
            if value is not None:
                item[field] = value
        for field in ('start', 'due'):
            value = getattr(args, field)
            if value:
                try:
                    t = datetime.fromisoformat(value.replace('Z', '+00:00'))
                except ValueError:
                    sys.exit(f'--{field}: use an ISO time like 2026-11-15T07:00 (NPT) or 2026-11-15T07:00+05:45')
                if t.tzinfo is None:
                    t = t.replace(tzinfo=NPT)
                item[f'{field}_at'] = t.isoformat()
        items = [item]
    res = call('items', {'items': items, 'keepProgress': not args.overwrite})
    print(f"Upserted {res.get('upserted')} item(s).")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('status', help='countdown, on now, late')
    p.add_argument('--json', action='store_true')
    p.set_defaults(fn=cmd_status)

    p = sub.add_parser('list', help='list items')
    p.add_argument('--kind', choices=KINDS)
    p.add_argument('--version')
    p.add_argument('--status', choices=STATUSES + ['late'])
    p.add_argument('--json', action='store_true')
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser('show', help='one item and its history')
    p.add_argument('id')
    p.add_argument('--json', action='store_true')
    p.set_defaults(fn=cmd_show)

    p = sub.add_parser('update', help='log progress on one item')
    p.add_argument('id')
    p.add_argument('--status', choices=STATUSES)
    p.add_argument('--progress', type=int, choices=range(0, 101), metavar='0-100')
    p.add_argument('--note')
    p.add_argument('--author')
    p.set_defaults(fn=cmd_update)

    p = sub.add_parser('note', help='log a general note')
    p.add_argument('text')
    p.add_argument('--author')
    p.set_defaults(fn=cmd_note)

    p = sub.add_parser('add', help='add items, or edit one (only the fields you give change)')
    p.add_argument('id', nargs='?')
    p.add_argument('kind', nargs='?', choices=KINDS)
    p.add_argument('title', nargs='?')
    p.add_argument('--file')
    p.add_argument('--detail')
    p.add_argument('--version')
    p.add_argument('--tier', choices=TIERS)
    p.add_argument('--lane')
    p.add_argument('--owner')
    p.add_argument('--gate')
    p.add_argument('--sort', type=int)
    p.add_argument('--start', help='ISO time; NPT if no zone, e.g. 2026-11-15T07:00')
    p.add_argument('--due', help='ISO time; NPT if no zone')
    p.add_argument('--overwrite', action='store_true', help='also apply status and progress given in --file items')
    p.set_defaults(fn=cmd_add)

    args = parser.parse_args()
    args.fn(args)


if __name__ == '__main__':
    main()
