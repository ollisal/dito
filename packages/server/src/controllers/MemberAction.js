import ControllerAction from './ControllerAction'
import { ControllerError } from '@/errors'

export default class MemberAction extends ControllerAction {
  // @override
  async getMember(ctx, param) {
    // member @parameters() can provide special query parameters as well,
    // and they can even controll forUpdate() behavior:
    // {
    //   member: true,
    //   query: { ... },
    //   forUpdate: true,
    //   modify: query => query.degbug()
    // }
    const {
      query = {},
      modify,
      forUpdate = false
    } = param || {}
    // member entries can provide special query parameters as well:
    // `{ member: true, query: { ... }, forUpdate: true }`
    return this.controller.member.find.call(
      this.controller,
      // Create a copy of `ctx` that inherits from the real one but overrides
      // query with the one defined in the parameter entry. This inherits the
      // route params in `ctx.params`, so fining the member by id still works.
      Object.setPrototypeOf({ query }, ctx),
      // Provide a `modify()` function for `find()`, to handle the setting of
      // `handler.scope` on the query, see the `base` argument in `setupQuery()`
      (query, trx) => {
        this.controller.setupQuery(query, this.handler)
        query.modify(modify)
        if (forUpdate) {
          if (!trx) {
            throw new ControllerError(
              this.controller,
              'Using `forUpdate()` without a transaction is invalid'
            )
          }
          query.forUpdate()
        }
      }
    )
  }
}
