# Requirements traceability

Source: `Healthcare_RSS_News_Reader.docx`. IDs are the 1-based positions of the 129 non-empty paragraphs in document order. Every paragraph is covered exactly once; adjacent paragraphs are grouped where they describe the same feature and share the same evidence/status. Section headings and illustrative sample rows are included as `Context`.

**Status:** `Done` means local implementation and evidence exist; `Deferred` means pending human approval and may still require verification before deployment; `Open` means a live deployment or other required verification is incomplete; `Context` means a heading or illustrative line with no separate behavior.

| DOCX paragraph(s) | Requirement or source text | Feature / evidence | Test or verification | Status |
|---|---|---|---|---|
| R001 | Login page | Login module | `apps/web/src/App.tsx` | Context |
| R002 | One master user alone | Unique-master creation and database constraint | `apps/api/src/auth.test.ts`; `apps/api/drizzle/` | Done |
| R003 | Login OTP through Hostinger email | Password + emailed OTP flow | `apps/api/src/auth.test.ts`; `apps/api/src/email/` | Deferred — pending human approval; needs live account; verify before deploy |
| R004-R007 | Credentials: name, password, sign-in button | Login form | `apps/web/src/App.test.tsx`; `apps/api/src/auth.test.ts` | Done |
| R008 | Password changes require OTP; master can add members | Password-change OTP and member administration | `apps/api/src/auth.test.ts`; `apps/api/src/members.test.ts` | Deferred — pending human approval; needs live account; verify before deploy |
| R009 | Landing page | Home/dashboard module | `apps/web/src/pages/HomePage.tsx` | Context |
| R010 | Keep only six modules | Six-item primary navigation | `apps/web/src/App.tsx`; Phase 6 report | Done |
| R011-R016 | News Feed, Sources, Recipients, Alerts and Schedule, Delivery Log, Settings | Six implemented modules | `apps/web/src/pages/`; `apps/web/e2e/accessibility.e2e.ts` | Done |
| R017 | Show username and role at top right | Authenticated app header | `apps/web/src/components/AppHeader.tsx`; `apps/web/src/App.test.tsx` | Done |
| R018-R020 | Live dashboard and WhatsApp/email connection lights | Polling dashboard and component health | `apps/api/src/dashboard.test.ts`; `apps/api/src/app.test.ts`; Phase 6 report | Deferred — pending human approval; needs live account; verify before deploy |
| R021 | News Feed | Feed module | `apps/web/src/pages/NewsFeedPage.tsx` | Context |
| R022 | Latest healthcare news, newest first | Feed ordering | `apps/api/src/rss.test.ts`; `apps/web/src/pages/NewsFeedPage.test.tsx` | Done |
| R023-R028 | Headline, source/category, date/time, two-line feed summary, original article link | News-item rendering and feed normalization | `apps/web/src/pages/NewsFeedPage.test.tsx`; `apps/api/src/rss.test.ts` | Done |
| R029 | Filters and search | Feed filtering controls | `apps/web/src/pages/NewsFeedPage.tsx` | Context |
| R030-R031 | Category/source/date filters and keyword search | Feed query and search | `apps/web/src/pages/NewsFeedPage.test.tsx`; `apps/api/src/rss.test.ts` | Done |
| R032 | Deduplicate by link, then similar headline | Canonical-link and headline deduplication | `apps/api/src/rss.test.ts` | Done |
| R033 | Buttons on every item | Item actions | `apps/web/src/pages/NewsFeedPage.tsx` | Context |
| R034-R036 | Mark important; send now by WhatsApp or email | News actions and delivery queue | `apps/web/src/pages/NewsFeedPage.test.tsx`; `apps/api/src/delivery.test.ts` | Done |
| R037 | Do not copy full articles; keep headline, short summary, and link | RSS normalization and persisted item shape | `apps/api/src/rss.test.ts` | Done |
| R038 | Sources (RSS feeds) | Source management module | `apps/web/src/pages/SourcesPage.tsx` | Context |
| R039-R041 | Manual source entry and forms | Source create/update form | `apps/web/src/pages/SourcesPage.test.tsx`; `apps/api/src/sources.test.ts` | Done |
| R042 | Source name/site/feed, all-updates or topic mode, region, supported fetch intervals | Source schema, form, and scheduler settings | `apps/web/src/pages/SourcesPage.test.tsx`; `apps/api/src/rss.test.ts`; `apps/api/src/sources.test.ts` | Done |
| R043 | Topics and keywords | Topic/category behavior | `apps/api/src/rss/categories.ts` | Context |
| R044 | Categorize from headline and summary keywords | Category assignment | `apps/api/src/rss.test.ts` | Done |
| R045-R046 | Category and sample-keywords headings | Category taxonomy | `apps/api/src/rss/categories.ts` | Context |
| R047-R058 | Six categories and their listed example keywords | Configured category keyword rules | `apps/api/src/rss/categories.ts`; `apps/api/src/rss.test.ts` | Done |
| R059 | Recipients | Recipient module | `apps/web/src/pages/RecipientsPage.tsx` | Context |
| R060-R062 | Manual recipient entry and forms | Recipient management form | `apps/web/src/pages/Phase4Pages.test.tsx`; `apps/api/src/recipients.test.ts` | Done |
| R063-R067 | Name, WhatsApp number, email, topics, channel selection | Recipient schema, encryption, and form | `apps/api/src/recipients.test.ts`; `apps/api/src/recipient-encryption.test.ts`; Phase 4 page tests | Done |
| R068 | Send only to people who consented | Consent checks before enqueue and send | `apps/api/src/delivery.test.ts`; `apps/web/src/pages/Phase4Pages.test.tsx` | Done |
| R069 | WhatsApp updates (OpenWA) | OpenWA adapter | `apps/api/src/delivery/openwa.ts` | Deferred — pending human approval; needs live account; verify before deploy |
| R070 | Send from admin number to the recipient profile number | Recipient-directed WhatsApp delivery | `apps/api/src/delivery.test.ts`; `apps/api/src/delivery/openwa.ts` | Deferred — pending human approval; needs live account; verify before deploy |
| R071 | Sample WhatsApp message | WhatsApp template | `apps/api/src/delivery/message.ts` | Context |
| R072-R083 | Digest title/date, numbered sample stories, source/category/link, and STOP instruction | Message formatting and STOP handling | `apps/api/src/delivery.test.ts` (`delivery message templates`; STOP test) | Deferred — pending human approval; needs live account; verify before deploy |
| R084 | Email updates (Hostinger email) | Email delivery | `apps/api/src/delivery/service.ts` | Deferred — pending human approval; needs live account; verify before deploy |
| R085 | Send from configured admin email to recipient email | Email recipient and sender configuration | `apps/api/src/delivery.test.ts`; `apps/api/src/email/` | Deferred — pending human approval; needs live account; verify before deploy |
| R086 | Sample email | Email template | `apps/api/src/delivery/message.ts` | Context |
| R087-R096 | Subject, sender, greeting, grouped stories, links, unsubscribe and manage-topics links | Email formatting and public preference routes | `apps/api/src/delivery.test.ts`; `apps/web/src/pages/Phase4Pages.test.tsx` | Deferred — pending human approval; needs live account; verify before deploy |
| R097 | Delivery Log | Delivery history module | `apps/web/src/pages/DeliveryLogPage.tsx` | Context |
| R098 | Filter by date/channel/recipient/status, download CSV/Excel, resend failed rows | Delivery API and UI | `apps/api/src/delivery.test.ts`; `apps/web/src/pages/DeliverySettingsPages.test.tsx` | Done |
| R099-R102 | Delivery table columns: time, recipient, channel, status | Delivery history table | `apps/web/src/pages/DeliverySettingsPages.test.tsx` | Done |
| R103-R126 | Illustrative delivered, pending, failed, and retrying rows for WhatsApp/email | Delivery status model and rendering | `apps/api/src/delivery.test.ts`; `apps/web/src/pages/DeliverySettingsPages.test.tsx` | Context |
| R127 | Green delivered, amber pending/retrying, red failed | Accessible delivery status styling and text | Phase 6 accessibility report; `apps/web/e2e/accessibility.e2e.ts` | Done |
| R128 | Hosting | Hosting section label | Deployment configuration | Context |
| R129 | Web app on Netlify | Static build and API proxy configuration | `netlify.toml`; `netlify/edge-functions/origin-secret.js`; `docs/RUNBOOK.md` | Open — live Netlify deployment and HTTPS require human verification |

## Approved Phase 7 deferrals

These are Phase 7 work items, not paragraphs from the requirements DOCX.

| Phase 7 task | Work item | Status |
|---|---|---|
| 7.2.1 | Extra database indexes | Deferred — pending human approval |
| 7.2.5 | Route-level bundle splitting | Deferred — pending human approval |

## Gate note

The table maps all 129 source paragraphs. Deferred entries remain pending human approval; live Netlify deployment and HTTPS remain open. See `PROGRESS.md` for the other open local and needs-human work.
