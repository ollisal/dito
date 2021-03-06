import { isString, isObject, asArray } from '@ditojs/utils'

export default class ControllerAction {
  constructor(controller, handler, type, name, verb, path, authorize) {
    this.controller = controller
    this.handler = handler
    this.type = type
    this.name = name
    this.identifier = `${type}:${name}`
    // Allow decorators on actions to override the predetermined defaults for
    // `verb`, `path` and `authorize`:
    this.verb = handler.verb || verb
    // Use ?? instead of || to allow '' to override the path.
    this.path = handler.path ?? path
    this.authorize = handler.authorize || authorize
    this.transacted = !!(
      handler.transacted ||
      controller.transacted ||
      // Core graph operations are always transacted:
      controller.graph && handler.core
    )
    this.authorization = controller.processAuthorize(this.authorize)
    this.app = controller.app
    this.paramsName = ['post', 'put'].includes(this.verb) ? 'body' : 'query'
    const { parameters, returns, options } = this.handler
    this.parameters = this.app.compileParametersValidator(parameters, {
      async: true,
      ...options?.parameters, // See @parameters() decorator
      rootName: this.paramsName
    })
    this.returns = this.app.compileParametersValidator(returns, {
      async: true,
      // Use instanceof checks instead of $ref to check returned values.
      // TODO: That doesn't guarantee the validity though...
      // This should always be $ref checks, I think?
      useInstanceOf: true,
      ...options?.returns, // See @returns() decorator
      rootName: 'result'
    })
  }

  getParams(ctx) {
    return ctx.request[this.paramsName]
  }

  setParams(ctx, query) {
    ctx.request[this.paramsName] = query
    return query
  }

  async callAction(ctx) {
    await this.validateParameters(ctx)
    const args = await this.collectArguments(ctx)
    await this.controller.handleAuthorization(this.authorization, ctx, ...args)
    const { identifier } = this
    await this.controller.emitHook(`before:${identifier}`, false, ctx, ...args)
    let result = await this.handler.call(this.controller, ctx, ...args)
    result = await this.validateResult(result)
    return this.controller.emitHook(`after:${identifier}`, true, ctx, result)
  }

  createValidationError(options) {
    return this.app.createValidationError(options)
  }

  async validateParameters(ctx) {
    if (!this.parameters.validate) return
    const root = this.getParams(ctx)
    // Start with root for params, but maybe we have to switch later, see below:
    let params = root
    // `parameters.validate(query)` coerces data in the query to the required
    // formats, according to the rules specified here:
    // https://github.com/epoberezkin/ajv/blob/master/COERCION.md
    // Coercion isn't currently offered for `type: 'object'`, so handle this
    // case prior to the call of `parameters.validate()`:
    const errors = []
    for (const { name, type, member } of this.parameters.list) {
      // Don't validate member parameters as they get resolved separately after.
      if (member) continue
      // If no name is provided, use the full root object as value:
      const useRoot = !name
      const param = useRoot ? root : params[name]
      let value = param
      // See if param needs additional coercion:
      if (['date', 'datetime', 'timestamp'].includes(type)) {
        value = new Date(param)
      } else {
        // See if the defined type(s) require coercion to objects:
        const objectType = asArray(type).find(
          // Coerce to object if type is 'object' or a known model name.
          type => type === 'object' || type in this.app.models
        )
        if (objectType) {
          if (param && isString(param)) {
            try {
              value = JSON.parse(param)
            } catch (err) {
              // Convert JSON error to Ajv validation error format:
              errors.push({
                dataPath: `.${name}`, // JavaScript property access notation
                keyword: 'type',
                message: err.message || err.toString(),
                params: {
                  type,
                  json: true
                }
              })
            }
          }
          if (objectType !== 'object' && isObject(value)) {
            // Convert the Pojo to the desired Dito model:
            const modelClass = this.app.models[objectType]
            if (modelClass && !(value instanceof modelClass)) {
              value = modelClass.fromJson(value, {
                // The model validation is handled separately through `$ref`.
                skipValidation: true
              })
            }
          }
        }
      }
      // See if coercion happened, and replace value in params with coerced one:
      if (value !== param) {
        // If root is to be used, replace `params` with a new object on which
        // to set the root object to validate under `parameters.rootName`
        // See: Application.compileParametersValidator()
        if (useRoot && params === root) {
          params = this.setParams(ctx, {})
        }
        params[useRoot ? this.parameters.rootName : name] = value
      }
    }
    try {
      await this.parameters.validate(params)
    } catch (error) {
      errors.push(...error.errors)
    }
    if (errors.length > 0) {
      throw this.createValidationError({
        type: 'ParameterValidation',
        message: `The provided data is not valid: ${
          JSON.stringify(this.getParams(ctx))
        }`,
        errors
      })
    }
  }

  async validateResult(result) {
    if (this.returns.validate) {
      const resultName = this.handler.returns.name
      // Use rootName if no name is given, see:
      // Application.compileParametersValidator(returns, { rootName })
      const resultData = {
        [resultName || this.returns.rootName]: result
      }
      try {
        await this.returns.validate(resultData)
      } catch (error) {
        throw this.createValidationError({
          type: 'ResultValidation',
          message: `Invalid result of action: ${JSON.stringify(result)}`,
          errors: error.errors
        })
      }
      // If no resultName was given, return the full root object (result).
      return resultName ? resultData : result
    }
    return result
  }

  async collectArguments(ctx) {
    const args = []
    const { list } = this.parameters
    if (list.length > 0) {
      // If we have parameters, add them to the arguments now,
      // while also keeping track of consumed parameters:
      const params = this.getParams(ctx)
      for (const entry of list) {
        // Handle `{ member: true }` parameters separately, by delegating to
        // `getMember()` to resolve to the given member.
        if (entry.member) {
          args.push(await this.getMember(ctx, entry))
        } else {
          const { name } = entry
          // If no name is provided, use the body object (params)
          args.push(name ? params[name] : params)
        }
      }
    }
    return args
  }

  async getMember(/* ctx, param */) {
    // This is only defined in MemberAction, where it resolves to the member
    // represented by the given action route.
    return null
  }
}
