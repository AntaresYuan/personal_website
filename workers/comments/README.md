# antares-comments

Reactions and comments for the Work space's Writing posts. They replace
giscus: no GitHub sign-in, they're reachable wherever the site is, and the UI
is the site's own.

- **Worker + D1.** One file of routes (`src/index.js`) and a SQLite database.
  There are zero npm dependencies, like the other Workers here.
- **Anonymous.** A nickname is enough. The email is optional and only exists
  for reply notices.
- **Turnstile** keeps bots out of the comment form. Reactions don't need it.
- **Llama Guard** (Workers AI) screens each comment. Some comments wait for
  you in `/admin` instead of being published:
  - a comment with a link
  - one with a long run of one character
  - one using the owner's name
  - one the model flags
  - one the model couldn't judge
- **Rate limits.**
  - 3 comments per 10 minutes and 20 per day from one IP.
  - One network can hold at most 5 of any one reaction on a page.

The client is `scripts/comments.js` with the `.discuss` styles in
`styles/work.css`. `scripts/build-blog.js` puts it on a post once
`content/site.json → comments.endpoint` is set; until then, posts keep giscus.

## Privacy

| Data | What is stored and who sees it |
|---|---|
| Public API (`GET /v1/thread`) | Name, comment text, time, and whether the comment is the author's. That's all. |
| IP and the browser's visitor id | Only as salted SHA-256 (`HASH_SALT`), for rate limits and "you reacted". |
| Email | Stored only while reply notices are on. It's used only to send them and is shown only in `/admin`. |
| Visitor's browser (localStorage) | The visitor id, the name and email last used, and their own comments still waiting for review. |

## Deploy (one-time)

```sh
cd workers/comments
npx wrangler login
npx wrangler d1 create antares-comments          # copy database_id into wrangler.toml
npx wrangler d1 execute antares-comments --remote --file=schema.sql
```

1. **Turnstile.** In the Cloudflare dashboard, go to Turnstile and choose
   Add widget. Set the hostname to `antaresyuan.site` and the mode to
   Managed. Keep the site key for step 4. Store the secret key:

   ```sh
   npx wrangler secret put TURNSTILE_SECRET
   ```

2. **Secrets.** Each one needs a long random string:

   ```sh
   npx wrangler secret put HASH_SALT                # e.g. `openssl rand -hex 32`
   npx wrangler secret put ADMIN_TOKEN              # ≥ 24 chars; you paste it into /admin once
   ```

3. **Deploy.** Run `npx wrangler deploy`. The custom domain
   `comments.antaresyuan.site` comes from `wrangler.toml`. It sits on the
   same zone as the site, so it is reachable from mainland China, and
   `workers_dev` stays off.

4. **Turn it on.** Put the endpoint and site key in `content/site.json`
   (or in the CMS under Site meta, then "Comments + reactions"):

   ```json
   "comments": {
     "endpoint": "https://comments.antaresyuan.site",
     "turnstileSiteKey": "0x4AAAA…"
   }
   ```

   Then rebuild (`node scripts/build.js`) and push.

5. **Moderate** at `https://comments.antaresyuan.site/admin`:
   - approve, unpublish or delete a comment
   - reply as the author, which shows the felt avatar and the Author badge

### Optional: email

Email uses [Resend](https://resend.com). Verify `antaresyuan.site` there, then:

```sh
npx wrangler secret put RESEND_API_KEY
```

Then set two vars in `wrangler.toml` and deploy:

- `MAIL_FROM`, e.g. `Antares Yuan <comments@antaresyuan.site>`
- `OWNER_EMAIL`, where alerts about new or held comments go

From then on:

- the form shows an optional email field;
- commenters get one email when someone replies to them;
- you get one email for each new or held comment.

While either value is missing, there are no emails, the form has no email
field, and no emails are stored.

## Settings (`[vars]`)

| Var | Default | |
|---|---|---|
| `PAGE_PATTERN` | `^/blog/[a-z0-9-]+/$` | The pages that may have a discussion. Widen it to add projects, e.g. `^/(blog\|projects)/[a-z0-9-]+/$`. |
| `REACTIONS` | `like,love,insight,fun` | The client draws an icon for each of these. A new kind needs one in `scripts/comments.js` → `ICONS`. |
| `MODERATION` | `ai` | `ai`, `hold` (everything waits) or `off`. |
| `OWNER_NAME` | `Antares` | The name on your replies. A visitor using it is held for review. |
| `ALLOWED_ORIGINS` | the site | CORS. Add a preview origin here if you need one. |

## Local development

```sh
cd workers/comments
cp .dev.vars.example .dev.vars                   # Turnstile's always-pass test secret, MODERATION=hold
npx wrangler d1 execute antares-comments --local --file=schema.sql
npx wrangler dev --local --port 8790

# In another terminal, from the repo root: build the posts against it.
# 1x00000000000000000000AA is Turnstile's always-pass test site key.
COMMENTS_ENDPOINT=http://127.0.0.1:8790 COMMENTS_SITEKEY=1x00000000000000000000AA node scripts/build-blog.js
```

The local admin page is at `http://127.0.0.1:8790/admin`; use the token from
`.dev.vars`. Rebuild without the two variables before committing.

Tests: `node workers/comments/test/lib.test.js`. They cover input checks,
review reasons, reading Llama Guard's answer, and the public shape of a
comment.
