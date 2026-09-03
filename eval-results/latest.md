# Drafting Engine Eval — 2026-09-03T02:57:35.915Z

19 cases · 18 queued · 1 blocked · adversarial case correctly blocked: true

## Rubric pass rates

- **tone**: 19/19
- **factualAccuracy**: 19/19
- **correctCTA**: 18/19
- **linksPresent**: 18/19

## Per-case results

| # | Case | Funnel/Stage | Owner | Queued | Tone | Facts | CTA | Links | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Warm-Up · has contact name | win_back/warm_up | audrey | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 2 | Soft Ask · has contact name | win_back/soft_ask | nick | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 3 | Incentive · has contact name | win_back/incentive | audrey | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 4 | Escalation · has contact email | win_back/escalation | nick | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 5 | Warm-Up · NO contact name (fallback) | win_back/warm_up | audrey | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 6 | Soft Ask · NO contact email | win_back/soft_ask | nick | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 7 | Incentive · high-value account | win_back/incentive | audrey | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 8 | Escalation · NO contact email | win_back/escalation | nick | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 9 | Proposal Check-In | proposal_follow_up/check_in | audrey | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 10 | Proposal DIY Fallback | proposal_follow_up/diy_fallback | nick | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 11 | Proposal Final Anchor | proposal_follow_up/final_anchor | audrey | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 12 | Proposal Check-In · NO contact name | proposal_follow_up/check_in | nick | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 13 | Nurture · has contact name | nurture/nurture | audrey | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 14 | Nurture · NO contact name | nurture/nurture | nick | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 15 | Warm-Up · second owner/account pair | win_back/warm_up | audrey | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 16 | Incentive · second owner/account pair | win_back/incentive | nick | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 17 | Proposal DIY Fallback · second pair | proposal_follow_up/diy_fallback | audrey | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 18 | Proposal Final Anchor · second pair | proposal_follow_up/final_anchor | nick | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| 19 | ADVERSARIAL · owner has no Calendly link configured (must be blocked) | win_back/soft_ask | temp_unconfigured | ❌ (expected) | ✅ | ✅ | ❌ | ❌ | missing or malformed per-owner Calendly link |

## Full drafts (queued cases only)

### Warm-Up · has contact name

**Subject:** Thinking of you, Renee Ibarra

```
Hi Renee Ibarra,

It's been a little while since we last worked together at Harborview Foundation, and your event anniversary is coming up. No ask here — just wanted to say hello and let you know we'd love to help again whenever the timing is right.

If it's ever useful, here's where to find time: https://calendly.com/audrey-impact4good?utm_content=e1

Warmly,
Audrey

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e1
```

### Soft Ask · has contact name

**Subject:** Ready to plan your next event, Marcus Bell?

```
Hi Marcus Bell,

Your event date is coming up again and I wanted to check in — would you like to get something on the calendar? Happy to pick up right where we left off.

Grab a time here if that's easiest: https://calendly.com/nick-impact4good?utm_content=e2

Best,
Nick

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e2
```

### Incentive · has contact name

**Subject:** A little something to welcome you back

```
Hi Dana Feldman,

I know things get busy — if it's helpful, we'd love to offer 5% off to make it easy to get back on the calendar. No pressure either way, just wanted you to have the option.

Book here: https://calendly.com/audrey-impact4good?utm_content=e3

Best,
Audrey

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e3
```

### Escalation · has contact email

**Subject:** [Personal outreach] Sunrise Family Services — at risk, no reply after Incentive

```
Elena Cruz hasn't replied after the warm-up, soft ask, and incentive touches. This account is now flagged at-risk — reach out personally by call or text rather than another email.

Account: Sunrise Family Services
Contact: Elena Cruz <elena@sunrisefamily.example>
```

### Warm-Up · NO contact name (fallback)

**Subject:** Thinking of you, Maple & Vine Community Kitchen

```
Hi there,

It's been a little while since we last worked together at Maple & Vine Community Kitchen, and your event anniversary is coming up. No ask here — just wanted to say hello and let you know we'd love to help again whenever the timing is right.

If it's ever useful, here's where to find time: https://calendly.com/audrey-impact4good?utm_content=e5

Warmly,
Audrey

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e5
```

### Soft Ask · NO contact email

**Subject:** Ready to plan your next event, Priya Shah?

```
Hi Priya Shah,

Your event date is coming up again and I wanted to check in — would you like to get something on the calendar? Happy to pick up right where we left off.

Grab a time here if that's easiest: https://calendly.com/nick-impact4good?utm_content=e6

Best,
Nick

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e6
```

### Incentive · high-value account

**Subject:** A little something to welcome you back

```
Hi Tomas Vidal,

I know things get busy — if it's helpful, we'd love to offer 5% off to make it easy to get back on the calendar. No pressure either way, just wanted you to have the option.

Book here: https://calendly.com/audrey-impact4good?utm_content=e7

Best,
Audrey

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e7
```

### Escalation · NO contact email

**Subject:** [Personal outreach] Lighthouse Youth Center — at risk, no reply after Incentive

```
Omar Hassan hasn't replied after the warm-up, soft ask, and incentive touches. This account is now flagged at-risk — reach out personally by call or text rather than another email.

Account: Lighthouse Youth Center
Contact: Omar Hassan
```

### Proposal Check-In

**Subject:** Checking in on your proposal

```
Hi Grace Kim,

Just wanted to check in on the proposal we sent — happy to answer any questions or make changes.

Easiest way to talk it through: https://calendly.com/audrey-impact4good?utm_content=e9

Best,
Audrey

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e9
```

### Proposal DIY Fallback

**Subject:** A lower-lift option, if that's more your speed

```
Hi Ben Torres,

No pressure on the full-service proposal — if a lighter-touch option works better for now, we also offer a DIY package starting at $4,500 that gives you the core essentials with less coordination on our end. Either path works for us, just let me know what fits.

Happy to walk through either option: https://calendly.com/nick-impact4good?utm_content=e10

Best,
Nick

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e10
```

### Proposal Final Anchor

**Subject:** Your event date is coming up

```
Hi Ava Chen,

Your event date is getting close, so I wanted to make sure we didn't lose the window if you'd like to move forward — full-service or DIY, whichever fits best right now.

Grab time here if that's easiest: https://calendly.com/audrey-impact4good?utm_content=e11

Best,
Audrey

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e11
```

### Proposal Check-In · NO contact name

**Subject:** Checking in on your proposal

```
Hi there,

Just wanted to check in on the proposal we sent — happy to answer any questions or make changes.

Easiest way to talk it through: https://calendly.com/nick-impact4good?utm_content=e12

Best,
Nick

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e12
```

### Nurture · has contact name

**Subject:** Checking in from Impact4Good

```
Hi Lena Ford,

No news to report — just staying in touch. Let us know if there's ever anything we can help with.

Always happy to find time: https://calendly.com/audrey-impact4good?utm_content=e13

Best,
Audrey

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e13
```

### Nurture · NO contact name

**Subject:** Checking in from Impact4Good

```
Hi there,

No news to report — just staying in touch. Let us know if there's ever anything we can help with.

Always happy to find time: https://calendly.com/nick-impact4good?utm_content=e14

Best,
Nick

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e14
```

### Warm-Up · second owner/account pair

**Subject:** Thinking of you, Sofia Reyes

```
Hi Sofia Reyes,

It's been a little while since we last worked together at Crescent Moon Wellness, and your event anniversary is coming up. No ask here — just wanted to say hello and let you know we'd love to help again whenever the timing is right.

If it's ever useful, here's where to find time: https://calendly.com/audrey-impact4good?utm_content=e15

Warmly,
Audrey

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e15
```

### Incentive · second owner/account pair

**Subject:** A little something to welcome you back

```
Hi Marcus Webb,

I know things get busy — if it's helpful, we'd love to offer 5% off to make it easy to get back on the calendar. No pressure either way, just wanted you to have the option.

Book here: https://calendly.com/nick-impact4good?utm_content=e16

Best,
Nick

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e16
```

### Proposal DIY Fallback · second pair

**Subject:** A lower-lift option, if that's more your speed

```
Hi Nadia Petrov,

No pressure on the full-service proposal — if a lighter-touch option works better for now, we also offer a DIY package starting at $4,500 that gives you the core essentials with less coordination on our end. Either path works for us, just let me know what fits.

Happy to walk through either option: https://calendly.com/audrey-impact4good?utm_content=e17

Best,
Audrey

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e17
```

### Proposal Final Anchor · second pair

**Subject:** Your event date is coming up

```
Hi Owen Clarke,

Your event date is getting close, so I wanted to make sure we didn't lose the window if you'd like to move forward — full-service or DIY, whichever fits best right now.

Grab time here if that's easiest: https://calendly.com/nick-impact4good?utm_content=e18

Best,
Nick

---
Don't want these emails? Opt out any time: http://localhost:3000/api/unsubscribe/e18
```

