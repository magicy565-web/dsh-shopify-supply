export class CommunityInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommunityInputError'
  }
}

export class CommunityNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommunityNotFoundError'
  }
}

export class CommunityUnauthorizedError extends Error {
  constructor(message = '请先登录后再继续') {
    super(message)
    this.name = 'CommunityUnauthorizedError'
  }
}

export class CommunityForbiddenError extends Error {
  constructor(message = '没有权限执行此操作') {
    super(message)
    this.name = 'CommunityForbiddenError'
  }
}
