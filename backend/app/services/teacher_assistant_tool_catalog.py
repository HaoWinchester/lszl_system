"""Dependency-free MCP schemas, available before business services initialize."""

def definitions():
    def tool(name,description,properties,required=()):
        return {'name':name,'description':description,'inputSchema':{'type':'object','properties':properties,'required':list(required),'additionalProperties':False}}
    uid={'type':'string','description':'list_files 中真实的上传 ID'}
    return [tool('list_files','列出此会话实际附件及解析状态；没有附件时明确返回空列表。',{}),
        tool('read_file','默认不传 page，按全文 offset 连续读取完整 JSON 或有来源标注的文档，每次最多8000字符。按 nextRead 续读；仅定位特定段落/页时传 page，单段结束不代表全文结束。',{'uploadId':uid,'page':{'type':'integer','minimum':1},'offset':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':8000}},['uploadId']),
        tool('read_image','读取附件页面真实图像。返回视觉 image block；OCR 文本不等于视觉理解。',{'uploadId':uid,'name':{'type':'string'}},['uploadId','name']),
        tool('prepare_import','仅在老师要求导入、整理题库或修改预览时生成可审核预览。不能执行导入/发布。settings/items 使用教师整理协议；文档首次提取 questions 须由你读取原文后忠实提交，最多500题，之后用筛选/patch修改，不能重写原题。',{'intent':{'type':'object'}},['intent'])]

