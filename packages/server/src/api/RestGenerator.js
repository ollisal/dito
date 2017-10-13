import objection from 'objection'
import colors from 'colors/safe'
import findQuery from 'objection-find'
import pluralize from 'pluralize'
import { hyphenate, isObject, keyItemsBy } from '../utils'
import { convertSchema } from '../core/schema'

export default class RestGenerator {
  constructor({ adapter, prefix, logger } = {}) {
    this.adapter = adapter || (() => {})
    this.logger = logger
    this.prefix = /\/$/.test(prefix) ? prefix : `${prefix}/`
    this.models = Object.create(null)
    this.findQueries = Object.create(null)
  }

  getFindQuery(modelClass) {
    const { name } = modelClass
    let query = this.findQueries[name]
    if (!query) {
      query = this.findQueries[name] = findQuery(modelClass)
    }
    return query
  }

  addModelRoutes(modelClass) {
    this.log(`${colors.green(modelClass.name)}${colors.white(':')}`)
    const { collection, member, relations } = modelClass.routes || {}
    this.addRoutes(modelClass, 'collection', collection, 1)
    // Install static methods before ids, as they wouldn't match otherwise
    this.addMethods(modelClass, 'collectionMethod', 1)
    this.addRoutes(modelClass, 'member', member, 1)
    this.addMethods(modelClass, 'memberMethod', 1)
    for (const relation of Object.values(modelClass.getRelations())) {
      this.log(`${colors.blue(relation.name)}${colors.white(':')}`, 1)
      this.addRoutes(relation, 'relation', relations, 2)
      this.addRoutes(relation, 'relationMember', relations, 2)
    }
  }

  addRoutes(target, type, accessOptions = {}, indent) {
    const handlers = restHandlers[type]
    const getAccess = accessHandlers[type]
    for (let [verb, handler] of Object.entries(getAccess ? handlers : {})) {
      // Freeze access object so we can pass the same one but no middleware
      // can alter it and affect future requests.
      const access = Object.freeze(getAccess(verb, accessOptions, target))
      if (!access) {
        continue
      }
      if (isObject(handler)) {
        if (handler.isValid && !handler.isValid(target)) {
          continue
        }
        handler = handler.handler
      }
      const route = this.getRoutePath(type, target)
      this.adapter({ verb, route, access },
        ctx => handler.call(this, target, ctx))
      this.log(`${colors.magenta(verb.toUpperCase())} ${colors.white(route)}`,
        indent)
    }
  }

  addMethods(modelClass, type, indent) {
    for (const [name, method] of Object.entries(modelClass.methods || {})) {
      if (type === 'memberMethod' ^ !!method.static) {
        const {
          verb = 'get',
          path = name
        } = method
        const route = this.getRoutePath(type, modelClass, path)
        // TODO: Access control for methods
        const access = true
        const handler = methodHandlers[type]
        const validate = {
          arguments: createArgumentsValidator(modelClass, method.arguments),
          return: createArgumentsValidator(modelClass, [method.return])
        }
        this.adapter({ verb, route, access },
          ctx => handler.call(this, modelClass, name, method, validate, ctx))
        this.log(`${colors.magenta(verb.toUpperCase())} ${colors.white(route)}`,
          indent)
      }
    }
  }

  log(str, indent = 0) {
    if (this.logger) {
      this.logger(`${'  '.repeat(indent)}${str}`)
    }
  }

  getRoutePath(type, target, param) {
    return `${this.prefix}${routePath[type](target, param)}`
  }
}

const routePath = {
  collection(modelClass) {
    return hyphenate(pluralize(modelClass.name))
  },
  collectionMethod(modelClass, path) {
    return `${routePath.collection(modelClass)}/${path}`
  },
  member(modelClass) {
    return `${routePath.collection(modelClass)}/:id`
  },
  memberMethod(modelClass, path) {
    return `${routePath.member(modelClass)}/${path}`
  },
  relation(relation) {
    return `${routePath.member(relation.ownerModelClass)}/${relation.name}`
  },
  relationMember(relation) {
    return `${routePath.relation(relation)}/:relatedId`
  }
}

/**
 * Access Handling
 */

function getAccess(verb, options) {
  return isObject(options) ? options[verb] : options
}

const accessHandlers = {
  collection: getAccess,
  member: getAccess,

  relation: (verb, relations, { name }) => {
    const relation = relations[name]
    return getAccess(verb, relation && relation.relation || relation)
  },

  relationMember: (verb, relations, { name }) => {
    const relation = relations[name]
    return getAccess(verb, relation && relation.member || relation)
  }
}

/**
 * Remote Methods
 */
function createArgumentsValidator(modelClass, args = []) {
  const validator = modelClass.getValidator()
  if (args.length > 0) {
    const properties = {}
    for (const arg of args) {
      if (arg) {
        const { name, type, ...rest } = arg
        properties[name || 'root'] = { type, ...rest }
      }
    }
    const schema = convertSchema(properties, validator)
    return validator.compileWithCoercing(schema)
  }
  return () => true
}

function getArguments(modelClass, method, validate, query) {
  if (!validate(query)) {
    throw new modelClass.ValidationError(validate.errors,
      `The provided data is not valid: ${JSON.stringify(query)}`)
  }
  const args = []
  for (const { name } of method.arguments || []) {
    args.push(name ? query[name] : query)
  }
  return args
}

function getReturn(modelClass, method, validate, value) {
  const { name } = method.return || {}
  return Promise.resolve(value).then(value => {
    // Use 'root' if no name is given, see createArgumentsValidator()
    const data = { [name || 'root']: value }
    if (!validate(data)) {
      throw new modelClass.ValidationError(validate.errors,
        `Invalid result of remote method: ${value}`)
    }
    return name ? data : value
  })
}

function checkMethod(method, modelClass, name, _static, statusCode = 404) {
  if (!method) {
    const prefix = _static ? 'Static remote' : 'remote'
    const err = new Error(
      `${prefix} method ${name} not found on Model ${modelClass.name}`)
    err.statusCode = statusCode
    throw err
  }
  return method
}

const methodHandlers = {
  collectionMethod(modelClass, name, method, validate, ctx) {
    const func = checkMethod(modelClass[name], modelClass, name, true)
    const args = getArguments(modelClass, method, validate.arguments, ctx.query)
    const value = func.call(modelClass, args)
    return getReturn(modelClass, method, validate.return, value)
  },

  memberMethod(modelClass, name, method, validate, ctx) {
    return restHandlers.member.get.call(this, modelClass, ctx)
      .then(model => {
        const func = checkMethod(model[name], modelClass, name, false)
        const args = getArguments(modelClass, method, validate.arguments,
          ctx.query)
        const value = func.call(model, args)
        return getReturn(modelClass, method, validate.return, value)
      })
  }
}

/**
 * Rest Routes
 */

function checkModel(model, modelClass, id, statusCode = 404) {
  if (!model) {
    const err = new Error(`Cannot find ${modelClass.name} model with id ${id}`)
    err.statusCode = statusCode
    throw err
  }
  return model
}

const restHandlers = {
  collection: {
    // post collection
    post(modelClass, ctx) {
      // TODO: Support multiples?, name it generatePostAll()?
      return objection.transaction(modelClass, modelClass => {
        return modelClass
          .query()
          .allowEager(this.getFindQuery(modelClass).allowEager())
          .eager(ctx.query.eager)
          .insert(ctx.body)
          .then(model => model.$query().first())
      })
    },

    // get collection
    get(modelClass, ctx) {
      return this.getFindQuery(modelClass).build(ctx.query, modelClass.query())
    },

    // patch collection
    patch(modelClass, ctx) {
      return this.getFindQuery(modelClass)
        .build(ctx.query, modelClass.query())
        .patch(ctx.body)
        .then(total => ({ total }))
    },

    // delete collection
    delete(modelClass, ctx) {
      return this.getFindQuery(modelClass)
        .build(ctx.query, modelClass.query())
        .delete()
        .then(total => ({ total }))
    }
  },

  member: {
    // get collection
    get(modelClass, ctx) {
      const { id } = ctx.params
      const builder = modelClass.query()
      return builder
        .allowEager(this.getFindQuery(modelClass).allowEager())
        .eager(ctx.query.eager)
        .where(builder.fullIdColumnFor(modelClass), id)
        .first()
        .then(model => checkModel(model, modelClass, id))
    },

    // put collection
    put(modelClass, ctx) {
      const { id } = ctx.params
      const builder = modelClass.query()
      return builder
        .update(ctx.body)
        .where(builder.fullIdColumnFor(modelClass), id)
        .then(model => {
          return modelClass
            .query()
            .allowEager(this.getFindQuery(modelClass).allowEager())
            .eager(ctx.query.eager)
            .where(builder.fullIdColumnFor(modelClass), id)
            .first()
        })
        .then(model => checkModel(model, modelClass, id))
    },

    // patch collection
    patch(modelClass, ctx) {
      const { id } = ctx.params
      const builder = modelClass.query()
      return builder
        .patch(ctx.body)
        .where(builder.fullIdColumnFor(modelClass), id)
        .then(() => {
          return modelClass
            .query()
            .allowEager(this.getFindQuery(modelClass).allowEager())
            .eager(ctx.query.eager)
            .where(builder.fullIdColumnFor(modelClass), id)
            .first()
        })
        .then(model => checkModel(model, modelClass, id))
    },

    // delete collection
    delete(modelClass, ctx) {
      const { id } = ctx.params
      return objection.transaction(modelClass, modelClass => {
        const builder = modelClass.query()
        return builder
          .delete()
          .where(builder.fullIdColumnFor(modelClass), id)
      }).then(() => ({})) // TODO: What does LB do here?
    }
  },

  relation: {
    // post relation
    post(relation, ctx) {
      const { id } = ctx.params
      const { ownerModelClass } = relation
      return objection.transaction(ownerModelClass, ownerModelClass => {
        const builder = ownerModelClass.query()
        return builder
          .where(builder.fullIdColumnFor(ownerModelClass), id)
          .first()
          .then(model => checkModel(model, ownerModelClass, id)
            .$relatedQuery(relation.name)
            .insert(ctx.body))
          .then(model => model
            .$query()
            .first()
            .allowEager(
              this.getFindQuery(relation.relatedModelClass).allowEager())
            .eager(ctx.query.eager))
      })
    },

    // get relation
    get(relation, ctx) {
      const { id } = ctx.params
      const { ownerModelClass } = relation
      const builder = ownerModelClass.query()
      return builder
        .where(builder.fullIdColumnFor(ownerModelClass), id)
        .first()
        .then(model => {
          checkModel(model, ownerModelClass, id)
          const query = this.getFindQuery(relation.relatedModelClass)
            .build(ctx.query, model.$relatedQuery(relation.name))
          return relation instanceof objection.BelongsToOneRelation
            ? query.first()
            : query
        })
    },

    // delete relation
    delete(relation, ctx) {
      const { id } = ctx.params
      const { ownerModelClass } = relation
      return objection.transaction(ownerModelClass, ownerModelClass => {
        const builder = ownerModelClass.query()
        return builder
          .where(builder.fullIdColumnFor(ownerModelClass), id)
          .first()
          .then(model => checkModel(model, ownerModelClass, id)
            .$relatedQuery(relation.name)
            .delete())
          .then(() => ({})) // TODO: What does LB do here?
      })
    },

    // put relation
    put: {
      isValid(relation) {
        return relation instanceof objection.BelongsToOneRelation
      },
      handler(relation, ctx) {
        const { id } = ctx.params
        const { ownerModelClass, relatedModelClass } = relation
        let model
        return objection.transaction(ownerModelClass, relatedModelClass,
          (ownerModelClass, relatedModelClass) => {
            const builder = ownerModelClass.query()
            return builder
              .where(builder.fullIdColumnFor(ownerModelClass), id)
              .first()
              .eager(relation.name)
              .then(mod => {
                model = checkModel(mod, ownerModelClass, id)
                const current = model[relation.name]
                const idKey = relatedModelClass.getIdProperty()
                const currentById = keyItemsBy(current, idKey)
                const inputModels = relatedModelClass.ensureModelArray(ctx.body)
                const inputModelsById = keyItemsBy(inputModels, idKey)

                function isNew(model) {
                  return !model.$id() || !currentById[model.$id()]
                }

                const insertModels = inputModels.filter(isNew)
                const updateModels = inputModels.filter(m => !isNew(m))
                const deleteModels = current.filter(
                  model => !inputModelsById[model.$id()])

                const insertAndUpdateQueries = [
                  ...updateModels.map(update => update.$query().patch()),
                  ...insertModels.map(insert => {
                    delete insert[relatedModelClass.getIdProperty()]
                    return model.$relatedQuery(relation.name).insert(insert)
                  })
                ]

                return model
                  .$relatedQuery(relation.name)
                  .delete()
                  .whereIn(builder.fullIdColumnFor(relatedModelClass),
                    deleteModels.map(model => model.$id()))
                  .then(() => Promise.all(insertAndUpdateQueries))
              })
              .then(() => model.$relatedQuery(relation.name))
          }
        )
      }
    }
  },

  relationMember: {
    // TODO: HasManyRelation, BelongsToOneRelation, HasOneThroughRelation,
    // ManyToManyRelation?

    // post relationMember = "generateRelationRelate" ??
    post: {
      isValid(relation) {
        return relation instanceof objection.ManyToManyRelation
      },
      handler(relation, ctx) {
        const { id, relatedId } = ctx.params
        const { ownerModelClass, relatedModelClass } = relation
        return objection.transaction(ownerModelClass, relatedModelClass,
          (ownerModelClass, relatedModelClass) => {
            const builder = ownerModelClass.query()
            return builder
              .where(builder.fullIdColumnFor(ownerModelClass), id)
              .first()
              .then(model => {
                return checkModel(model, ownerModelClass, id)
                  .$relatedQuery(relation.name)
                  .relate(relatedId)
              })
              .then(() => {
                return relatedModelClass
                  .where(builder.fullIdColumnFor(relation.relatedModelClass),
                    relatedId)
                  .allowEager(
                    this.getFindQuery(relation.relatedModelClass).allowEager())
                  // TODO: Shouldn't this be ctx.query.eager?
                  .eager(ctx.params.eager)
                  .first()
              })
          }
        )
      }
    }
  }
}

