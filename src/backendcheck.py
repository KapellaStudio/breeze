#!/usr/bin/env python3
"""Breeze backend security contract — static, dependency-free CI gate."""
from pathlib import Path
import re, sys

ROOT = Path(__file__).resolve().parents[1]
files = {
    'download': ROOT/'netlify/functions/download.js',
    'releases': ROOT/'netlify/functions/releases.js',
    'waitlist': ROOT/'netlify/functions/waitlist.js',
    'ops': ROOT/'supabase/functions/breeze-ops/index.ts',
    'env': ROOT/'.env.example',
}
text = {k:p.read_text() for k,p in files.items()}
checks=[]
def check(name, ok): checks.append((name, bool(ok)))

netlify = '\n'.join(text[k] for k in ('download','releases','waitlist'))
check('Netlify contains no service-role/admin-key reference', 'SUPABASE_SERVICE_ROLE_KEY' not in netlify and 'SUPABASE_SECRET_KEYS' not in netlify and 'sb_secret_' not in netlify)
check('Release reads use publishable/anon key only', 'SUPABASE_PUBLISHABLE_KEY' in text['download'] and 'SUPABASE_PUBLISHABLE_KEY' in text['releases'])
check('Modern publishable reads are not sent as Bearer JWTs', 'Authorization' not in text['download'] and 'Authorization' not in text['releases'])
check('Privileged writes require Breeze Ops token', text['waitlist'].count('BREEZE_OPS_TOKEN') >= 1 and text['download'].count('BREEZE_OPS_TOKEN') >= 1)
check('Waitlist routes through Breeze Ops', "action: 'waitlist'" in text['waitlist'] and '/functions/v1/breeze-ops' in text['waitlist'])
check('Download counter routes through Breeze Ops', "action: 'record_download'" in text['download'] and '/functions/v1/breeze-ops' in text['download'])
check('Ops authenticates SHA-256 token digests', len(re.findall(r"'[0-9a-f]{64}'", text['ops'])) >= 1 and 'crypto.subtle.digest' in text['ops'])
check('Ops uses constant-time digest comparison', 'constantTimeEqual' in text['ops'])
check('Ops has no committed raw Breeze token', not re.search(r"BREEZE_OPS_TOKEN\s*=\s*['\"][A-Za-z0-9_\-]{32,}", text['ops']))
check('Ops action surface is narrow', text['ops'].count("body.action ===") == 2 and "body.action === 'waitlist'" in text['ops'] and "body.action === 'record_download'" in text['ops'])
check('Ops validates download platform', 'PLATFORMS.has(platform)' in text['ops'])
check('Ops validates waitlist email', 'EMAIL.test(email)' in text['ops'])
check('Example env exposes no admin-key slot', 'SUPABASE_SERVICE_ROLE_KEY' not in text['env'] and 'SUPABASE_SECRET_KEYS' not in text['env'])

for name,ok in checks:
    print(('PASS' if ok else 'FAIL') + '  ' + name)
failed=[n for n,o in checks if not o]
print(f"\nBackend: {len(checks)-len(failed)}/{len(checks)} checks passed")
if failed:
    sys.exit(1)
