import http from 'http'
import Node from './Node'
import Result from './Result'

const CHAR_SLASH = '/'.charCodeAt(0)

export default class Router {
  constructor(options) {
    this.trees = {}
    this._options = options || {}
  }

  add(method, path, handler) {
    path = this.normalizePath(path)
    const tree = this.trees[method] || (this.trees[method] = new Node())
    tree.add(path, handler)
    return this
  }

  find(method, path) {
    path = this.normalizePath(path)
    const tree = this.trees[method]
    return tree && tree.find(path) || new Result(this, method, path, tree)
  }

  getAllowedMethods(path = null, exclude = null) {
    if (path) {
      const allowed = []
      // Search for allowed methods in all trees.
      for (const method in this.trees) {
        if (method === exclude) {
          continue
        }
        const tree = this.trees[method]
        if (tree.find(path)?.handler) {
          allowed.push(method)
        }
      }
      return allowed
    } else {
      return Object.keys(this.trees)
    }
  }

  get(...args) {
    return this.add('GET', ...args)
  }

  put(...args) {
    return this.add('PUT', ...args)
  }

  post(...args) {
    return this.add('POST', ...args)
  }

  delete(...args) {
    return this.add('DELETE', ...args)
  }

  head(...args) {
    return this.add('HEAD', ...args)
  }

  patch(...args) {
    return this.add('PATCH', ...args)
  }

  options(...args) {
    return this.add('OPTIONS', ...args)
  }

  trace(...args) {
    return this.add('TRACE', ...args)
  }

  connect(...args) {
    return this.add('CONNECT', ...args)
  }

  all(...args) {
    for (const method of http.METHODS) {
      this.add(method, ...args)
    }
    return this
  }

  normalizePath(path) {
    const { strict, prefix } = this._options
    if (!strict && path !== '/') {
      // When not in strict mode, remove trailing slash from any path except
      // '/', and make sure path starts with '/'
      const { length } = path
      if (path.charCodeAt(length - 1) === CHAR_SLASH) {
        path = path.substring(0, length - 1)
      }
      if (path.charCodeAt(0) !== CHAR_SLASH) {
        path = '/' + path
      }
    }
    return prefix ? prefix + path : path
  }

  toString(method = 'GET') {
    const tree = this.trees[method.toUpperCase()]
    return tree ? tree.toString() : ''
  }
}
