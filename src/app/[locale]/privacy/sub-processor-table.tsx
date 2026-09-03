import { aiSubProcessors } from '@/entities/ai-model';

/**
 * Who else touches personal data, and what for.
 *
 * Its own file because the list is the part of this policy that actually
 * changes — a new AI provider, a push service, a store — and because the page
 * it lives on is long enough already. The AI rows are read from the model
 * catalogue rather than typed here, so a provider swap cannot leave the policy
 * describing a company we no longer use.
 */
export function SubProcessorTable() {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Sub-processor</th>
            <th>Purpose</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>OVH</td>
            <td>Hosting (web server, database)</td>
            <td>France (EU)</td>
          </tr>
          <tr>
            <td>Stripe, Inc.</td>
            <td>Payment processing, fraud prevention</td>
            <td>USA (with EU representative)</td>
          </tr>
          <tr>
            <td>Cloudflare, Inc.</td>
            <td>Object storage (R2) and DNS</td>
            <td>Global (EU edge available)</td>
          </tr>
          {aiSubProcessors().map((sp) => (
            <tr key={sp.entity}>
              <td>{sp.entity}</td>
              <td>
                {sp.role}
                {sp.entity === 'Google LLC'
                  ? '; Google Sign-In (OAuth, optional sign-in method); Google reCAPTCHA (anti-bot verification on signup and the free-audit page); Google Analytics 4 (aggregate audience measurement, only with your consent)'
                  : null}
              </td>
              <td>{sp.location}</td>
            </tr>
          ))}
          <tr>
            <td>
              Push services: Google LLC (FCM), Apple Inc. (APNs), Mozilla, Microsoft — whichever
              your browser or device uses
            </td>
            <td>
              Delivery of the notifications you asked for. They receive the device endpoint or token
              and the encrypted notice; we never send them your account data.
            </td>
            <td>USA / EU</td>
          </tr>
          <tr>
            <td>Google LLC (Google Play) and Apple Inc. (App Store)</td>
            <td>
              Distribution of our mobile application, where you install it from their store. They
              act as independent controllers for the download itself and for any purchase made
              through them.
            </td>
            <td>USA / Ireland (EU)</td>
          </tr>
          <tr>
            <td>FirstPromoter (Vilocity SRL)</td>
            <td>
              Affiliate programme: records that a partner&apos;s link led to an account, so their
              commission can be calculated. Receives the referral identifier, your email, your
              account id and your IP address at signup — only when you arrived through such a link.
            </td>
            <td>European Union</td>
          </tr>
          <tr>
            <td>Discord Inc.</td>
            <td>
              Delivery of contact-form messages to a private, staff-only channel of our Discord
              server (via our own bot), so support requests are seen immediately
            </td>
            <td>USA</td>
          </tr>
          <tr>
            <td>Meta Platforms Ireland Limited</td>
            <td>
              Meta Pixel — advertising conversion measurement for our Facebook/Instagram ads (only
              with your consent). Acts as a joint/independent controller for the events it receives.
            </td>
            <td>Ireland (EU) / USA</td>
          </tr>
          <tr>
            <td>Sendinblue SAS (Brevo)</td>
            <td>Transactional email relay (e.g. password reset)</td>
            <td>France (EU)</td>
          </tr>
          <tr>
            <td>Hostinger / domain registrar</td>
            <td>DNS for the public hostname</td>
            <td>EU</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
