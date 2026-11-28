/**
 * TEMPORARY DEV AID: delete this block and devPassword.js before deployment
 *
 * Attaches `devTempPassword` to employee creation / credential resend response
 * when the email was NOT actually sent (emailSent is false, or mail was not
 * actually sent via SMTP in non-production fallback) AND NODE_ENV is not 'production'.
 * In every other case, the field is absent.
 *
 * @param {object} responseObj - The response body object
 * @param {string} tempPassword - Plain temporary password
 * @param {boolean} emailSent - Flag indicating whether email was successfully sent
 * @param {object|null} mailResult - The result returned from sendStaffCredentialsEmail
 * @returns {object} Response object with or without devTempPassword
 */
export function attachDevPassword(responseObj, tempPassword, emailSent, mailResult = null) {
  const isProduction = process.env.NODE_ENV === 'production';

  // Email is considered actually sent ONLY if emailSent is true AND it was not a dev fallback
  const isEmailActuallySent = Boolean(emailSent) && !mailResult?.devFallback;

  if (!isProduction && !isEmailActuallySent && tempPassword) {
    return {
      ...responseObj,
      devTempPassword: tempPassword,
    };
  }

  // Ensure devTempPassword is never present in any other case
  const { devTempPassword, ...cleanObj } = responseObj;
  return cleanObj;
}
