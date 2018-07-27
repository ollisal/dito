import { isArray, asArray, getDataPath } from '@ditojs/utils'
import { modelGraphToExpression, ensureModelArray } from '.'

export class GraphProcessor {
  constructor(rootModelClass, data, options, settings) {
    this.rootModelClass = rootModelClass
    this.data = ensureModelArray(rootModelClass, data)
    this.isArray = isArray(data)
    this.options = options
    this.overrides = {}
    this.numOptions = Object.keys(options).length
    this.numOverrides = 0
    if (settings.processOverrides) {
      this.collectOverrides()
      if (this.numOverrides > 0) {
        this.processOverrides()
      }
    }
    this.removedRelations = settings.restoreRelations && {}
  }

  getOptions() {
    return this.numOverrides > 0
      ? { ...this.options, ...this.overrides }
      : this.options
  }

  getData() {
    // If setting.restoreRelations is used, call processRelate() to filter out
    // nested relations of models that are used for relates, but keep the
    // removed relations to restore them again on the results.
    // See: restoreRelations()
    const data = this.removedRelations
      ? this.processRelates(this.data)
      : this.data
    return this.isArray ? data : data[0]
  }

  getGraphOptions(relation) {
    // When a relation is owner of its data, then a fall-back for `graphOptions`
    // is provided where both `relate` and `unrelate` id disabled, resulting in
    // inserts and deletes instead.
    const ownerOptions = {
      relate: false,
      unrelate: false
    }
    // Determine the `graphOptions` to be used for this relation.
    return relation.graphOptions || relation.owner && ownerOptions || {}
  }

  /**
   * Loops through all nested relations and finds the ones that define local
   * overrides of the global options, then collects empty override arrays for
   * each setting, so processOverrides() can fill them if any overrides exist.
   */
  collectOverrides() {
    // TODO: we may want optimize this code to only collect the overrides for
    // the relations that are actually used in the graph, e.g. through
    // `modelGraphToExpression(data)`. Should we ever switch to our own
    // implementation of *AndFetch() methods, we already have to call this.
    const processed = {}
    const processModelClass = modelClass => {
      const { name } = modelClass
      // Only process each modelClass once, to avoid circular reference loops.
      if (!processed[name]) {
        processed[name] = true
        const { relations } = modelClass.definition
        const relationInstances = modelClass.getRelations()
        for (const [name, relation] of Object.entries(relations)) {
          const graphOptions = this.getGraphOptions(relation)
          if (graphOptions) {
            // Loop through `this.options` and only look for overrides of them,
            // since `relation.graphOptions` is across insert  / upsert & co.,
            // but not all of them use all options (insert defines less).
            for (const key in this.options) {
              if (key in graphOptions &&
                  graphOptions[key] !== this.options[key] &&
                  !this.overrides[key]) {
                this.numOverrides++
                this.overrides[key] = []
              }
            }
            // Keep scanning until we're done or found that all options have
            // overrides.
            if (this.numOverrides < this.numOptions) {
              processModelClass(relationInstances[name].relatedModelClass)
            }
          }
        }
      }
    }

    processModelClass(this.rootModelClass)
  }

  /**
   * Fills the empty override arrays collected by collectOverrides() by walking
   * through the actual graph and finding relations that have overrides, and
   * building relation paths for them.
   */
  processOverrides() {
    const node = modelGraphToExpression(this.data)

    const processExpression =
      (node, modelClass, relation, relationPath = '') => {
        if (relation) {
          const graphOptions = this.getGraphOptions(relation)
          // Loop through all override options, figure out their settings for
          // the current relation and build relation expression arrays for each
          // override reflecting their nested settings in arrays of expressions.
          for (const key in this.overrides) {
            const option = graphOptions[key] ?? this.options[key]
            if (option) {
              this.overrides[key].push(relationPath)
            }
          }
        }

        const { relations } = modelClass.definition
        const relationInstances = modelClass.getRelations()
        for (const key in node) {
          const child = node[key]
          const { relatedModelClass } = relationInstances[key]
          processExpression(
            child,
            relatedModelClass,
            relations[key],
            appendPath(relationPath, '.', key)
          )
        }
      }

    processExpression(node, this.rootModelClass)
  }

  shouldRelate(relationPath) {
    // Root objects (relationPath === '') should never relate.
    if (relationPath !== '') {
      const { relate } = this.overrides
      return relate
        // See if the relate overrides contain this particular relation-Path
        // and only remove and restore relation data if relate is to be used
        ? relate.includes(relationPath)
        : this.options.relate
    }
  }

  /**
   * Handles relate option by detecting Objection instances in the graph and
   * converting them to shallow id links.
   *
   * For details, see:
   * https://gitter.im/Vincit/objection.js?at=5a4246eeba39a53f1aa3a3b1
   */
  processRelates(data, relationPath = '', dataPath = '') {
    if (data) {
      if (data.$isObjectionModel) {
        const relations = data.constructor.getRelationArray()
        const relate = this.shouldRelate(relationPath)
        const clone = data.$clone({ shallow: relate })
        if (relate) {
          // TODO: Remove not only relations, but also all fields from graph
          // that aren't owning their data, and convert them to references.
          // Fill removedRelations with json-pointer -> relation-value pairs,
          // so that we can restore the relations again after the operation in
          // restoreRelations():
          if (this.removedRelations) {
            const values = {}
            let hasRelations = false
            for (const { name } of relations) {
              const value = data[name]
              if (value !== undefined) {
                values[name] = value
                hasRelations = true
              }
            }
            if (hasRelations) {
              this.removedRelations[dataPath] = values
            }
          }
        } else {
          for (const { name } of relations) {
            const value = this.processRelates(
              clone[name],
              appendPath(relationPath, '.', name),
              appendPath(dataPath, '/', name)
            )
            if (value !== undefined) {
              clone[name] = value
            }
          }
        }
        return clone
      } else if (isArray(data)) {
        // Pass on relate for hasMany arrays.
        return data.map((entry, index) => this.processRelates(
          entry,
          relationPath,
          appendPath(dataPath, '/', index)
        ))
      }
    }
    return data
  }

  /**
   * Restores relations in the final result removed by processRelates()
   */
  restoreRelations(result) {
    const data = asArray(result)
    for (const [path, values] of Object.entries(this.removedRelations || {})) {
      const obj = getDataPath(data, path)
      for (const key in values) {
        obj[key] = values[key]
      }
    }
    return result
  }
}

function appendPath(path, separator, token) {
  return path !== '' ? `${path}${separator}${token}` : token
}
