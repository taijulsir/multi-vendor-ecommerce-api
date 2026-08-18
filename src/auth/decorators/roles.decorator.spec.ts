import { Reflector } from '@nestjs/core';

import { ROLES_KEY, Roles } from './roles.decorator';

describe('@Roles()', () => {
  it('attaches the given roles as metadata under ROLES_KEY, nothing else', () => {
    class TestController {
      @Roles('ADMIN', 'VENDOR')
      handler() {}
    }

    const reflector = new Reflector();
    const metadata = reflector.get(
      ROLES_KEY,
      TestController.prototype.handler,
    );

    expect(metadata).toEqual(['ADMIN', 'VENDOR']);
  });

  it('attaches an empty array when called with no roles', () => {
    class TestController {
      @Roles()
      handler() {}
    }

    const reflector = new Reflector();
    const metadata = reflector.get(
      ROLES_KEY,
      TestController.prototype.handler,
    );

    expect(metadata).toEqual([]);
  });

  it('does not attach anything to a handler it is not applied to', () => {
    class TestController {
      @Roles('ADMIN')
      protectedHandler() {}

      unprotectedHandler() {}
    }

    const reflector = new Reflector();
    const metadata = reflector.get(
      ROLES_KEY,
      TestController.prototype.unprotectedHandler,
    );

    expect(metadata).toBeUndefined();
  });
});
