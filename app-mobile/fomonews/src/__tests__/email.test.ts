import { isValidEmailFormat } from '../validation/email';

describe('isValidEmailFormat', () => {
  it.each(['a@b.com', 'user.name@example.co', 'x+tag@sub.domain.com'])(
    'accepts valid email %s',
    (email) => {
      expect(isValidEmailFormat(email)).toBe(true);
    },
  );

  it.each(['', 'not-an-email', '@missing-local.com', 'missing-domain@', 'spaces in@email.com', 'no-at-sign.com'])(
    'rejects invalid email %s',
    (email) => {
      expect(isValidEmailFormat(email)).toBe(false);
    },
  );
});
