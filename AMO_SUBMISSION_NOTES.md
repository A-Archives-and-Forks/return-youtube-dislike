# AMO 4.0.5 Submission Notes

## Files to upload

- Add-on package: `return-youtube-dislike-firefox-4.0.5.zip`
- Source package: `return-youtube-dislike-source-4.0.5.zip`
- Privacy policy: copy `Docs/Privacy Policy` into the AMO listing privacy-policy field.

## Backend deployment prerequisite

Deploy the matching backend entitlement change **before releasing extension 4.0.5** or publishing its privacy policy.
The account flow must request only currently entitled Patreon tier IDs for eligibility, with no membership amount,
charge-date/status, lifetime-payment, or patron-status attributes. Verify that behavior and a fresh reviewer-account
login against the deployed backend. The source changes and these notes do not establish that the live backend has
already been updated.

## Notes to reviewer

Version 4.0.5 addresses rejection reference `a424a6ef-1172-4c6c-8028-22187c194255` and the earlier source-code
review concerns.

The Firefox manifest now uses Firefox's built-in data-collection consent system and requires Firefox 140 or later. It
retains the published add-on ID `{762f9885-5a13-4abd-9c77-433dcd38b8fd}` and declares these required data categories:

- `personallyIdentifyingInfo`: a persistent random installation `userId` is registered with the Return YouTube Dislike
  API and is included with vote submissions. Optional sign-in also processes provider account identifiers, name,
  profile image, and email when returned by GitHub under this category. Patreon does not request or return email.
- `browsingActivity`: the current YouTube `videoId` identifies the video page being viewed and is sent for dislike
  lookups and related analytics.
- `websiteContent`: the current YouTube `videoId` and, when available, visible `likeCount` are sent to the API to obtain
  and improve the dislike estimate.
- `websiteActivity`: a user-initiated Like, Dislike, or vote removal is sent as the vote `value` with the `videoId` and
  random `userId`.

The optional Patreon/GitHub account feature declares `authenticationInfo`. The matching backend determines Patreon
access from currently entitled tier IDs, without requesting or using membership amounts, charge dates or status,
lifetime payments, or patron status. Firefox requests authentication permission directly from the corresponding
sign-in click. Denying it produces no OAuth, session-verification, or premium Bearer-token traffic. Removing it clears
the account session, tears down active premium analytics, and blocks
later account requests. Delayed login and verification responses cannot restore a revoked session. Core dislike counts
continue to work. Browser sync may synchronize extension settings, identifiers, and account sessions when enabled.

Treating tier IDs as account entitlements covered by account identity and authentication declarations is our data-category
interpretation; Mozilla has not approved this classification. Paid access remains disclosed in the listing. The
`financialAndPaymentInfo` category is omitted because the matching backend no longer requests or processes the financial
and payment attributes used by the earlier implementation. Removing an obsolete financial-data grant alone does not
sign the user out; revoking authentication consent does.

Firefox private-window access is disabled so private browsing data is not retained. The popup no longer makes an
unrelated remote version check or server-status probe, and packaged extension pages no longer request remote fonts.

The supplied source archive contains the lockfile, exact production inputs, and build instructions. From its root,
install Node.js 22.17.0 and npm 10.8.2, then run:

```sh
node scripts/build-firefox-source.mjs
```

The generated comparison directory is `Extensions/combined/dist/firefox`. The build script checks the version,
manifest consent contract, required `menu-fixer.js`, bundle size, absence of source-map references, and source-input
receipt. Dependencies are installed only through npm from the npm registry.

## Functional review path

1. Install in a fresh Firefox 140-or-newer profile and accept the required data categories.
2. Open a public YouTube video and confirm the dislike estimate appears.
3. Open the extension popup. Decline either Patreon or GitHub sign-in consent and confirm the account remains signed
   out while ordinary dislike counts continue working.
4. Grant the optional authentication permission and sign in with the supplied reviewer account. Exercise the premium
   analytics panel using that account's active premium access.
5. Revoke authentication data under `about:addons` > Return YouTube Dislike > Permissions and data. Confirm
   the account session ends and no premium panel appears on subsequent navigation or after restarting Firefox.

## Listing and reviewer access

Add this disclosure to the listing description:

> Return YouTube Dislike sends the current YouTube video ID and visible like count to its API to display dislike
> estimates. Optional vote submissions include a persistent random installation ID and your selected vote. Optional
> Patreon/GitHub sign-in processes account and membership information. Premium analytics has eligibility requirements,
> including paid Patreon membership tiers. Core dislike counts are free. Firefox asks for required data consent during installation or update and
> requests optional account-data consent when you sign in.

Before submission, deploy the backend entitlement change and complimentary-access grant, then verify a fresh login with the dedicated
Patreon test account. Supply that account's login details in AMO's **Notes for Reviewers**, as described in the
[submission guide](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/). Mozilla requires
reviewer access to account-only functionality. Do not place credentials in this file or in the source archive.
Confirm the listing discloses paid functionality and includes the updated privacy policy.

Include these instructions with the login details:

> This is a dedicated Patreon test account with complimentary premium access granted by our backend. No paid
> subscription is needed. In the extension popup, choose Log in with Patreon, accept the optional account-data
> permission prompt, and complete Patreon authorization using the supplied test account. Open a YouTube video and
> its premium analytics. Complimentary access is available through October 5, 2026 (UTC); contact us if the review
> requires an extension.

## Policy references

- [Built-in data consent and data categories](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- [Submission and data-transmission requirements](https://extensionworkshop.com/documentation/publish/add-on-policies/)
- [Source-code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)

Temporary developer installs silently grant required permissions and do not prove the installation/update consent
prompt. Test that prompt using a packaged install in a disposable Firefox Developer Edition or Nightly profile.
