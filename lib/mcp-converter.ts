import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export interface CopilotKitParameter {
  name: string
  type: string
  description?: string
  required?: boolean
  attributes?: CopilotKitParameter[]
  items?: any
}

export interface CopilotKitAction {
  name: string
  description: string
  parameters: CopilotKitParameter[]
  handler: (args: any) => Promise<any>
}

export class MCPToolConverter {
  static convertMCPToolToAction(
    mcpTool: Tool,
    handler: (args: any) => Promise<any>
  ): CopilotKitAction {
    return {
      name: mcpTool.name,
      description: mcpTool.description || `Execute ${mcpTool.name} tool`,
      parameters: this.convertJSONSchemaToParams((mcpTool as any).inputSchema),
      handler,
    }
  }

  private static convertJSONSchemaToParams(schema: any): CopilotKitParameter[] {
    if (!schema || !schema.properties) return []
    const required: string[] = schema.required || []
    return Object.entries(schema.properties).map(([name, prop]: [string, any]) => {
      const param: CopilotKitParameter = {
        name,
        type: this.mapJSONSchemaType(prop.type, prop.items),
        description: prop.description,
        required: required.includes(name),
      }
      if (prop.type === 'object' && prop.properties) {
        param.attributes = this.convertJSONSchemaToParams(prop)
      }
      if (prop.type === 'array' && prop.items) {
        param.items = {
          type: prop.items.type,
          properties: prop.items.properties,
          enum: prop.items.enum,
        }
      }
      if (prop.enum) {
        param.type = 'string'
        param.description = `${param.description || ''} (Options: ${prop.enum.join(', ')})`
      }
      return param
    })
  }

  private static mapJSONSchemaType(jsonType: string | string[], items?: any): string {
    if (Array.isArray(jsonType)) {
      jsonType = jsonType.find(t => t !== 'null') || 'string'
    }
    const typeMap: Record<string, string> = {
      string: 'string',
      number: 'number',
      integer: 'number',
      boolean: 'boolean',
      object: 'object',
    }
    if (jsonType === 'array') {
      if (items?.type === 'object') return 'object[]'
      if (items?.type === 'string') return 'string[]'
      if (items?.type === 'number') return 'number[]'
      return 'object[]'
    }
    return typeMap[jsonType] || 'string'
  }
}
