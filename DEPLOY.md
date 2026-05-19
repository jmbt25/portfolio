# DEPLOY.md

## Goal

Live site at `https://<project-name>.pages.dev`, deployed automatically on every push to `main`.

## Prerequisites

- GitHub account with the `portfolio` repo created (empty, no README/license)
- Cloudflare account (free tier is fine)
- Local: Node 20+, npm, git

## Step 1: Push the local repo to GitHub

After Claude Code finishes scaffolding and the build is clean:

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin git@github.com:{{github_handle}}/portfolio.git
git push -u origin main
```

Verify by opening `https://github.com/{{github_handle}}/portfolio` in a browser.

## Step 2: Connect Cloudflare Pages to the repo

1. Log into the Cloudflare dashboard
2. Navigate to: **Workers & Pages** → **Create** → **Pages** tab → **Connect to Git**
3. Authorize Cloudflare to access your GitHub account if prompted
4. Select the `portfolio` repository
5. Configure the build:
   - **Project name:** `portfolio` (this becomes the subdomain)
   - **Production branch:** `main`
   - **Framework preset:** Astro (Cloudflare auto-detects)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** `/` (leave default)
6. Under **Environment variables** (Production):
   - `NODE_VERSION` = `20`
7. Click **Save and Deploy**

First build takes ~60–90 seconds.

## Step 3: Verify the live site

Cloudflare gives you a URL like `https://portfolio-abc.pages.dev`. Open it.

Check:
- [ ] Home page loads, hero renders, 4 projects show
- [ ] `/projects` loads, 4 expanded entries
- [ ] `/about` loads, all sections render
- [ ] Nav active states work (current page is highlighted)
- [ ] JetBrains Mono is loaded (not falling back to system mono)
- [ ] Mobile view (Chrome DevTools, 375px width): no horizontal scroll, header wraps cleanly
- [ ] All external links open in new tabs
- [ ] Run Lighthouse on the deployed URL: Performance ≥ 95 on mobile

## Step 4 (optional): Custom domain

If you have a domain:

1. Cloudflare Pages → your project → **Custom domains** → **Set up a custom domain**
2. Enter your domain or subdomain
3. Follow the DNS instructions Cloudflare shows
4. SSL provisioning is automatic, takes a few minutes

## Future deploys

Every `git push` to `main` triggers a new build. Pull request previews are automatic — Cloudflare deploys each PR to a unique preview URL.

## Rollback

Cloudflare Pages → your project → **Deployments** → find the previous good deploy → **Rollback to this deployment**. Takes ~10 seconds.

## Troubleshooting

**Build fails on Cloudflare but works locally:** Almost always a Node version mismatch. Confirm `NODE_VERSION=20` is set in the environment variables.

**Fonts don't load:** Check the browser console for CSP or referrer policy issues. The `_headers` file should not block Google Fonts.

**404 on `/projects` or `/about`:** Cloudflare Pages serves static files; Astro generates `projects/index.html` and `about/index.html` which should work without configuration. If broken, check `dist/` after a local build — those files must exist.