export function assertFields(value: unknown, fields: readonly string[], label: string): asserts value is object {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new Error(`${label} must be an object`)
    }
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !fields.includes(key)) throw new Error(`Unknown ${label} field: ${String(key)}`)
    }
}

export function assertList(value: unknown, field: string, max = Infinity): asserts value is unknown[] {
    if (!Array.isArray(value) || value.length > max || Object.keys(value).length !== value.length
        || Object.keys(value).some((key, index) => key !== String(index))) {
        throw new Error(`${field} must be an indexed array with at most ${max} entries`)
    }
}

export function validText(value: unknown): value is string {
    return typeof value === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
}

export function phpTrim(value: string): string {
    return value.replace(/^[ \t\n\r\x00\x0B]+|[ \t\n\r\x00\x0B]+$/g, '')
}

export function positiveInteger(value: unknown, field: string): string {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`Invalid ${field}: expected a safe positive integer`)
    if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`Invalid ${field}`)
    const digits = String(value).trim()
    if (!/^\d+$/.test(digits)) throw new Error(`Invalid ${field}`)
    const integer = BigInt(digits)
    if (integer <= 0n || integer > 9223372036854775807n) throw new Error(`Invalid ${field}: outside signed 64-bit range`)
    return integer.toString()
}
