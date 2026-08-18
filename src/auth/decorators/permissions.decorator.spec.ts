import { Reflector } from '@nestjs/core';

import { PERMISSIONS_KEY, Permissions } from './permissions.decorator';

describe('@Permissions()', () => {
  it('attaches the given resource+action permissions as metadata under PERMISSIONS_KEY', () => {
    class TestController {
      @Permissions(
        { resource: 'products', action: 'read' },
        { resource: 'orders', action: 'read' },
      )
      handler() {}
    }

    const reflector = new Reflector();
    const metadata = reflector.get(
      PERMISSIONS_KEY,
      TestController.prototype.handler,
    );

    expect(metadata).toEqual([
      { resource: 'products', action: 'read' },
      { resource: 'orders', action: 'read' },
    ]);
  });

  it('attaches an empty array when called with no permissions', () => {
    class TestController {
      @Permissions()
      handler() {}
    }

    const reflector = new Reflector();
    const metadata = reflector.get(
      PERMISSIONS_KEY,
      TestController.prototype.handler,
    );

    expect(metadata).toEqual([]);
  });

  it('does not attach anything to a handler it is not applied to', () => {
    class TestController {
      @Permissions({ resource: 'products', action: 'read' })
      protectedHandler() {}

      unprotectedHandler() {}
    }

    const reflector = new Reflector();
    const metadata = reflector.get(
      PERMISSIONS_KEY,
      TestController.prototype.unprotectedHandler,
    );

    expect(metadata).toBeUndefined();
  });
});
