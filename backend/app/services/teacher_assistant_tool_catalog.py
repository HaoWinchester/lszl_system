"""Dependency-free MCP schemas, available before business services initialize."""

def definitions():
    def tool(name,description,properties,required=()):
        return {'name':name,'description':description,'inputSchema':{'type':'object','properties':properties,'required':list(required),'additionalProperties':False}}
    uid={'type':'string','description':'list_files 中真实的上传 ID'}
    intent={'type':'object','properties':{
        'reply':{'type':'string'},
        'settings':{'type':'object','properties':{
            'names':{'type':'object','additionalProperties':{'type':'string'},'description':'精确命名：以真实上传 ID 为键、老师要求的完整名称为值。“命名为 X”必须使用此字段；如已有旧后缀，需同时将 nameSuffix 设为 ""。'},
            'nameSuffix':{'type':'string','description':'仅当老师明确要求追加后缀时使用；不能用于“命名为”。'},
            'allowedRoles':{'type':'array','items':{'type':'string','enum':['teacher','student','admin','viewer']},'description':'明确可见角色。“只有教师能看到”填写 ["teacher"]；教师和学员填写 ["teacher","student"]。未指定时省略以保留已有范围；只有明确撤销所有开放角色时使用 []，不能用空数组代替明确指定的角色。'},
            'accessLevel':{'type':'string','enum':['private','free','member'],'description':'访问等级；与 allowedRoles 独立。'},
            'enabledModes':{'type':'array','items':{'type':'string','enum':['deep_recall','multi_question_canvas','practice_mode']}},
            'duplicatePolicy':{'type':'string','enum':['independent','reuse','cancel']},
            'publish':{'type':'boolean'},'directPublish':{'type':'boolean'}}},
        'items':{'type':'array','items':{'type':'object'}},
        'blockers':{'type':'array','items':{'type':'string'}}}}
    return [tool('list_files','列出此会话实际附件及解析状态；没有附件时明确返回空列表。',{}),
        tool('read_file','默认不传 page，按全文 offset 连续读取完整 JSON 或有来源标注的文档，每次最多8000字符。按 nextRead 续读；仅定位特定段落/页时传 page，单段结束不代表全文结束。',{'uploadId':uid,'page':{'type':'integer','minimum':1},'offset':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':8000}},['uploadId']),
        tool('read_image','读取附件页面真实图像。返回视觉 image block；OCR 文本不等于视觉理解。',{'uploadId':uid,'name':{'type':'string'}},['uploadId','name']),
        tool('prepare_import','仅在老师要求导入、整理题库或修改预览时生成可审核预览。不能执行导入/发布。settings/items 使用教师整理协议；文档首次提取 questions 须由你读取原文后忠实提交，最多500题，之后用筛选/patch修改，不能重写原题。核对返回的 settings 和 items.name 是否落实老师要求，不符时更正预览。',{'intent':intent},['intent'])]
