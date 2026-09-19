#!/usr/bin/env python3
"""Local preview server that refuses to be cached.

The stock `python3 -m http.server` sends Last-Modified and no Cache-Control, so
a browser happily serves its stored copy of index.html after a rebuild. That
turned into a real problem: the page was rebuilt and the browser kept showing
the previous version, which looks exactly like "the fix did not work".

Every response here carries no-store, so what you see is always what is on
disk.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_header(self, keyword, value):
        # Drop the validators too — with these present a browser can still get
        # a 304 and reuse the stale body.
        if keyword.lower() in ('last-modified', 'etag'):
            return
        super().send_header(keyword, value)

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8830
    ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
