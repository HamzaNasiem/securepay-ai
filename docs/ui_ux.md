# UI/UX Specification — SecurePay AI

---

## 1. Design Principles
- **Trust through transparency**: every decision the system makes must be visible and explained — never a bare "declined."
- **Show the token, not the card**: the UI should visually reinforce that a disposable token, not the real card, is what's moving through the system.
- **Judge-legible in 60 seconds**: a judge watching a demo video should understand the value prop from the UI alone, without narration.

## 2. Screens

### 2.1 Checkout Screen (User App)
**Purpose:** simulate a user paying for something, generating a token instead of exposing a card.

**Elements:**
- Merchant name + amount (pre-filled for demo, e.g. "Netflix — 1,200 PKR").
- Large button: "Generate secure token."
- On click: displays the generated token in a card-like UI element (masked as `4539 **** **** 1234`), with a countdown timer showing TTL (e.g. "expires in 4:58").
- Small caption under the token: "This number is disposable. Your real card is never sent."
- Button: "Send to merchant" (simulates the merchant receiving the token).

**States:**
- Idle → Token generating (loading spinner, ~1s) → Token active (countdown visible) → Token used/expired (grayed out, label changes to "Used" or "Expired").

### 2.2 Merchant Simulator View (optional, can be a simple secondary panel)
**Purpose:** visually prove the merchant only ever receives the token.

**Elements:**
- A minimal "merchant checkout" mockup showing the token field populated — explicitly labeled "Received: token only. No real card data present."

### 2.3 Dashboard (core screen for judges)
**Purpose:** show the AI's reasoning live — this is the screen the demo video should spend the most time on.

**Layout:**
- Header: "Transaction feed" + live indicator dot.
- Table/feed, most recent transaction on top, each row expandable:
  | Time | Merchant | Amount | Risk score | Decision | 
  - Clicking a row expands to show the full AI explanation sentence(s).
- Color coding for decision:
  - Approve → green badge
  - Step-up → amber badge
  - Decline → red badge
- Risk score shown as a small horizontal bar (0–100) next to the badge, not just a number — makes it scannable at a glance.
- "Kill token" button visible on any still-active token row.

### 2.4 Empty/Error States
- No transactions yet: "No transactions yet — generate a token to see it in action."
- AI engine unreachable: transaction row still appears, but risk badge shows "Manual review" in gray with tooltip "AI risk engine unavailable."

## 3. Visual Language
- Clean, flat, fintech-neutral palette: deep navy/charcoal for structure, one accent color (teal or blue) for primary actions, semantic colors (green/amber/red) reserved strictly for decision status — not used decoratively elsewhere.
- Typography: one sans-serif family, two weights max (regular/medium) — avoid heavy/bold everywhere, it reads as unpolished.
- Motion: token countdown timer should visibly tick down — this single detail does more to sell "disposable, time-limited" than any text label.

## 4. Key User Flows (for demo video storyboard)

**Flow 1 — "Watch a safe payment happen"**
1. Open checkout → generate token → token appears with countdown.
2. Click "send to merchant."
3. Cut to dashboard → new row appears live → click to expand → show AI's plain-English "this looks safe" explanation.

**Flow 2 — "Watch a risky payment get caught"**
1. Pre-seed a scenario with an unrecognized device / mismatched location in the demo data.
2. Same flow as above, but dashboard shows a red "Decline" badge with an explanation naming the specific red flag.

**Flow 3 — "Kill a token"**
1. On dashboard, find an active (unused) token.
2. Click "Kill token."
3. Attempt to reuse it (a second `/pay` call) → show it auto-declines with explanation "Token was manually revoked."

## 5. Accessibility Notes (quick wins, not blocking for hackathon)
- Don't rely on color alone for decision status — always pair with text label ("Approve"/"Decline"), not just a colored dot.
- Ensure countdown timer text has sufficient contrast against its background.

## 6. What NOT to build (time-saving guidance)
- No user authentication/login flow — hardcode a single demo user.
- No multi-merchant catalog — 2–3 pre-set merchants (Netflix, a grocery store, an international site) are enough to tell the story.
- No mobile-responsive polish — desktop-only demo is acceptable; judges watch a recorded video, not a live responsive test.
