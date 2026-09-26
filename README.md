# NFS Portal

A retro-styled community hub and safe-house for street racers, inspired by the iconic aesthetic of **Need for Speed: Most Wanted (2005)**. Built with vanilla web technologies and powered by Supabase Realtime.

---

## Screenshots for instance:

<p align="center">
  <img src="https://github.com/user-attachments/assets/5da40178-2687-473f-8022-3a51559bc7a4" width="48%" alt="Screenshot 1" />
  <img src="https://github.com/user-attachments/assets/0dc45d0c-3f84-4fc2-ad4f-da529e2e5cd9" width="48%" alt="Screenshot 2" />
</p>
<p align="center">
  <img src="https://github.com/user-attachments/assets/050d0f97-3c2b-452f-986d-4fd470460349" width="48%" alt="Screenshot 3" />
  <img src="https://github.com/user-attachments/assets/cdd31ee2-abde-4d43-b00d-7f0188c907ef" width="48%" alt="Screenshot 4" />
</p>

---

## Features

- **Leaderboard:** Dynamic driver ratings, custom ranks, and a signature glowing frame for the #1 racer.
- **Racer Profiles & Garage:** Showcase personal rides, customize profile bio, choose frames.
- **Guest Mode (Read-Only Access):** Visitors can freely explore the leaderboard, browse garages, and read forum threads without forced registration. Interactive actions (chatting, commenting, garage uploads) are seamlessly protected.
- **Private DMs:** Instant messaging powered by Supabase Realtime channels with notification badges.
- **Community Forum:** Discussion boards with instant redirection to newly published topics, reply tagging (`@mention`), and moderation controls.
- **Steam-Style Friends Overlay:** Live tracking of friends activity.
- **Moderation Suite:** Timed mute penalties, role badges (`ADM`, `MOD`, `VIP`), and global broadcast announcements.

---

## Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript
- **Backend as a Service:** [Supabase](https://supabase.com/)
  - Authentication (Email & Password)
  - PostgreSQL Database with Row Level Security (RLS)
  - Realtime Presence & Database Changes
  - Supabase Storage (Avatars, attachments & car photos)

---

## Get started

👉 **[Launch NFS Portal](https://davenport-ok.github.io/nfs-portal)**
