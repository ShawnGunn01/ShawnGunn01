# Apollo.io Dashboard Integration Guide

## Overview

The Metrics Dashboard integrates with Apollo.io to pull real-time campaign performance data, eliminating manual tracking and ensuring metrics always reflect actual outbound execution.

## Setup Instructions

### Step 1: Get Your Apollo API Key

1. Log into your Apollo.io account
2. Navigate to **Settings** → **API & Integrations**
3. Copy your **API Key**
4. Keep this key secure (treat like a password)

### Step 2: Connect in Dashboard

1. Open the Metrics Dashboard
2. Paste your Apollo API Key into the "Apollo API Key" field
3. Click **Connect Apollo**
4. You'll see a confirmation message: "✓ Connected to Apollo"

### Step 3: Sync Real Data

1. Click **Sync Apollo Data** to pull latest campaign metrics
2. Dashboard will update with real numbers:
   - Emails Sent (actual campaign volume)
   - Open Rate (% of emails opened)
   - Reply Rate (% of emails replied to)
   - Raw Leads (actual replies received)

## What Data Syncs

**From Apollo Campaigns**:
- `messages_sent` → Emails Sent count
- `messages_opened` → Open Rate calculation
- `messages_replied` → Reply Rate + Raw Leads
- `messages_bounced` → Bounce tracking

**Real-Time Visibility**:
- Email channel performance (critical for go/no-go decisions)
- Outbound velocity tracking
- Response quality measurement
- Campaign ROI analysis

## API Security

✅ **Best Practices**:
- API key stored only in your browser session (never sent to external servers)
- Key is NOT saved or logged anywhere
- Connection test validates key before use
- Disconnect by refreshing the page

⚠️ **Important**:
- Never share your API key
- Regenerate key if accidentally exposed
- Use personal API key (not team-wide)

## Sync Frequency

**Manual Sync**: Click "Sync Apollo Data" to update anytime

**Recommended Schedule**:
- Morning: Start of day (baseline)
- End of Day: Check daily performance
- Weekly: Full week review
- At Decision Gates: Before go/no-go decisions (Day 30, 60, 90)

## Troubleshooting

**"Invalid API Key"**
- Check key is copied completely (no extra spaces)
- Verify key is active in Apollo settings
- Regenerate key if needed

**"Failed to fetch campaigns"**
- Check internet connection
- Verify Apollo account is active
- API may be rate-limited (wait 5 min, retry)

**No data showing up**
- Ensure campaigns have been run in Apollo
- Check campaign status (active/completed)
- Verify emails were actually sent through Apollo

## Metrics Interpretation

**Email Open Rate Target**: 25–35%
- Actual metric compared to expected by month
- Red if <18%, Yellow if 18–25%, Green if 25%+

**Email Reply Rate Target**: 5–8%
- Genuine responses only (not auto-replies)
- Quality indicator of personalization

**Raw Leads**: All replies
- Combined with scoring to create MQL/SQL pipeline
- Feed into sales cycle tracking

## Manual Entry Alternative

If you prefer not to connect Apollo:
1. Copy metrics from Apollo dashboard weekly
2. Enter "Current Month" and "Day" manually
3. Dashboard will show projected vs. simulated actual
4. Update by clicking "Update Dashboard"

Both approaches work—API integration is for **real-time automation**, manual entry for **privacy/security**.

## Example Workflow

**Week 1**:
1. Deploy 50 emails via Apollo
2. End of day: Click "Sync Apollo Data"
3. Dashboard shows: 50 sent, 28% open rate, 6% reply rate
4. Compare to expectations

**Week 4 (Go/No-Go)**:
1. Sync latest Apollo data
2. Dashboard shows Month 1 actuals vs. targets
3. Use data for Day 30 decision (GO/OPTIMIZE/NO-GO)
4. Export metrics for reporting

## Next Steps

1. ✅ Get API key from Apollo settings
2. ✅ Connect in dashboard
3. ✅ Sync data to validate connection
4. ✅ Set up recurring sync schedule
5. ✅ Use real metrics for execution decisions

**Dashboard is now a real operational tool, not a projection.**
