# iChat

A WhatsApp-style web app built with React, Vite and Supabase.

- **Create account / Log in** with email verification (verified users land on the home page)
- **Home** dashboard, **Posts** feed (text, photos, videos, likes), **Messages** (private chats and groups with photos and videos), **Account** (profile, avatar, settings, password)
- **Voice and video calls** between two users or inside a group (WebRTC, signalled through Supabase Realtime)

## 1. Set up Supabase (about 5 minutes)

1. Create a project at https://supabase.com.
2. **SQL Editor** → paste the whole of `supabase/schema.sql` → **Run**. Run it once on a fresh project.
3. **Authentication → Providers → Email**: keep *Confirm email* turned **on**.
4. **Authentication → URL Configuration** (this is what makes the verification link open your site):
   - **Site URL**: your live address, e.g. `https://YOUR-USER.github.io/ichat/`
   - **Redirect URLs**: add `https://YOUR-USER.github.io/ichat/**` and `http://localhost:5173/**`
5. **Authentication → Emails / SMTP**: Supabase's built-in sender allows only a few emails per hour and is meant for testing. Add a custom SMTP provider (Resend, Postmark, Brevo, SendGrid...) before real users sign up, or verification emails will be rate limited.
6. **Project Settings → API**: copy the *Project URL* and the *anon public* key.

## 2. Run locally

```bash
npm install
cp .env.example .env     # then fill in the two Supabase values
npm run dev
```

Open http://localhost:5173. Camera and microphone work on `localhost` and on any `https` site.

## 3. Push to GitHub and go live (GitHub Pages)

```bash
git init
git add .
git commit -m "iChat"
git branch -M main
gh repo create ichat --public --source=. --push
```

(No GitHub CLI? Create an empty repo named `ichat` on github.com, then run
`git remote add origin https://github.com/YOUR-USER/ichat.git && git push -u origin main`.)

Then in the repo on GitHub:

1. **Settings → Secrets and variables → Actions → New repository secret**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. (Optional TURN secrets: `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`.)
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push again (or run the workflow from the **Actions** tab). Your site goes live at `https://YOUR-USER.github.io/ichat/`.
4. Make sure that exact address is the Site URL in step 1.4 above.

The anon key is designed to be public. Your data is protected by the Row Level Security rules in `schema.sql`.

Prefer Vercel or Netlify? Import the repo, add the two env vars, and deploy. `vercel.json` and `public/_redirects` are already included.

## How it works

| Area | Notes |
| --- | --- |
| Auth | Supabase email + password. `emailRedirectTo` sends verified users to the site root (home page). A database trigger creates the profile row. |
| Posts | Visible to every signed-in user. Media lives in the public `public-media` bucket. Realtime keeps feeds in sync. |
| Messages | Direct chats are created through `get_or_create_direct_chat` (one chat per pair). Groups through `create_group`. Row Level Security means only members can read a chat. Chat media is stored in the **private** `chat-media` bucket and served with short-lived signed URLs. |
| Calls | A call starts by writing a `call_start` message, which rings every member of the chat. Media is peer-to-peer WebRTC. Signalling uses a **private** Realtime channel that only chat members may join. Group calls use a mesh (each person connects to each other person). |

## Known limits

- **TURN server:** calls use free public STUN. About 80 to 90 percent of connections work directly, but some corporate or mobile networks need a TURN relay. Add one with the `VITE_TURN_*` variables for reliable calls.
- **Group call size:** mesh calls are comfortable up to about 4 to 6 people. Bigger rooms need an SFU service (LiveKit, Daily, etc.).
- **Ringing needs the app open:** there are no push notifications, so a user only hears a call while iChat is open in a tab. Group calls also show a *Join call* button in the chat.
- **Media size:** images and videos up to 50 MB (also the Supabase free-plan limit).
- Supabase free projects pause after a week of inactivity.
