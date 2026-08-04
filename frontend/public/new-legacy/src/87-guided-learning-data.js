'use strict';

/*
 * GuidedLearningData v13
 * 固定课程编排：课程 → 阶段 → 部分 → 节点 → 活动。
 * 节点只保存活动 ID；路径页不加载活动正文，练习页按 nodeId 获取固定内容。
 */
(function(global){
  const activities={};

  function addChoiceSet(prefix,items){
    items.forEach((item,index)=>{
      const id=prefix+'-'+String(index+1).padStart(2,'0');
      activities[id]={
        id,
        type:'choice',
        stem:item.stem,
        options:item.options,
        shortExplanation:item.shortExplanation||'你已经抓住了本题的关键判断。',
        detailedExplanation:item.detailedExplanation||item.explanation||'',
        explanation:item.explanation||'',
        incorrectFeedback:item.incorrectFeedback||'当前判断还不正确，请重新关注题目所处的环境、角色职责和约束条件。'
      };
    });
    return items.map((_,index)=>prefix+'-'+String(index+1).padStart(2,'0'));
  }

  function addKeywordSet(prefix,items){
    items.forEach((item,index)=>{
      const id=prefix+'-'+String(index+1).padStart(2,'0');
      const segments=Array.isArray(item.segments)?item.segments:[];
      activities[id]={
        id,
        type:'keyword',
        instruction:item.instruction||'请从题干中选择关键线索。',
        segments,
        requiredSelectionCount:Number(item.requiredSelectionCount)||segments.filter(segment=>segment.target).length,
        shortExplanation:item.shortExplanation||'你已经识别出决定判断方向的关键线索。',
        detailedExplanation:item.detailedExplanation||item.explanation||'',
        explanation:item.explanation||'',
        incorrectFeedback:item.incorrectFeedback||'请重新关注项目环境、角色和当前执行限制。',
        hints:Array.isArray(item.hints)?item.hints.map(hint=>String(hint||'').trim()).filter(Boolean):[],
        hintAfterWrong:Math.max(1,Number(item.hintAfterWrong)||1)
      };
    });
    return items.map((_,index)=>prefix+'-'+String(index+1).padStart(2,'0'));
  }

  function addMatchingSet(prefix,items){
    items.forEach((item,index)=>{
      const id=prefix+'-'+String(index+1).padStart(2,'0');
      const pairs=Array.isArray(item.pairs)?item.pairs:[];
      activities[id]={
        id,
        type:'matching',
        instruction:item.instruction||'依次选择左侧项目和右侧对应内容，完成全部配对。',
        pairs,
        rightOrder:item.rightOrder||[...pairs].reverse().map(pair=>pair.id),
        shortExplanation:item.shortExplanation||'你已经正确区分了这些概念之间的对应关系。',
        detailedExplanation:item.detailedExplanation||item.explanation||'',
        explanation:item.explanation||'配对完成。',
        incorrectFeedback:item.incorrectFeedback||'请重新比较各项目的职责边界和定义。'
      };
    });
    return items.map((_,index)=>prefix+'-'+String(index+1).padStart(2,'0'));
  }

  function addOpenTextSet(prefix,items){
    items.forEach((item,index)=>{
      const id=prefix+'-'+String(index+1).padStart(2,'0');
      activities[id]={
        id,
        type:'open_text',
        prompt:item.prompt,
        minLength:item.minLength===undefined?30:Math.max(1,Number(item.minLength)||1),
        maxLength:item.maxLength===undefined?140:Math.max(20,Number(item.maxLength)||140),
        requiredConcepts:Array.isArray(item.requiredConcepts)?item.requiredConcepts:[],
        evaluationMode:String(item.evaluationMode||'concept_match'),
        referenceAnswer:String(item.referenceAnswer||item.explanation||''),
        placeholder:String(item.placeholder||''),
        shortExplanation:item.shortExplanation||'你的回答已经覆盖本题要求的核心要点。',
        detailedExplanation:item.detailedExplanation||item.explanation||'',
        explanation:item.explanation||''
      };
    });
    return items.map((_,index)=>prefix+'-'+String(index+1).padStart(2,'0'));
  }

  function addMemorySet(prefix,items){
    items.forEach((item,index)=>{
      const id=prefix+'-'+String(index+1).padStart(2,'0');
      const pairs=Array.isArray(item.pairs)?item.pairs:[];
      activities[id]={
        id,
        type:'memory_match',
        instruction:item.instruction||'翻开两张卡片，找出正确配对。',
        pairs,
        cardOrder:Array.isArray(item.cardOrder)?item.cardOrder:[],
        shortExplanation:item.shortExplanation||'全部卡片已经正确配对。',
        detailedExplanation:item.detailedExplanation||item.explanation||'',
        explanation:item.explanation||''
      };
    });
    return items.map((_,index)=>prefix+'-'+String(index+1).padStart(2,'0'));
  }


  activities['deep-recall-case-01']={
    id:'deep-recall-case-01',
    type:'deep_recall',
    title:'迭代中期的高价值新需求',
    caseStem:'一个敏捷团队正在进行两周迭代。迭代中期，客户提出一个高价值新功能，希望团队立即加入当前迭代。项目经理应如何推动正确处理？',
    clueTask:{
      instruction:'请选择决定处理方向的关键线索。',
      requiredSelectionCount:3,
      segments:[
        {text:'一个 '},
        {text:'敏捷团队',target:true},
        {text:' 正在进行 '},
        {text:'两周迭代',target:true},
        {text:'。迭代中期，客户提出一个 '},
        {text:'高价值新功能',target:true},
        {text:'，希望团队立即加入当前迭代。'}
      ],
      shortExplanation:'你已经识别出敏捷环境、当前迭代约束和业务价值三个关键方向。',
      hints:[
        '先分别寻找能够确定方法环境、当前工作节奏和需求价值的词。',
        '关键线索应覆盖“敏捷环境、迭代约束、业务价值”三个不同方向。'
      ]
    },
    conceptQuestions:[
      {
        id:'deep-concept-environment',
        stem:'“敏捷团队”和“两周迭代”首先说明什么？',
        options:[
          {id:'A',text:'应采用敏捷环境下的角色与工件判断',correct:true},
          {id:'B',text:'必须立即提交变更控制委员会',feedback:'题干首先描述的是敏捷迭代环境，不应直接套用预测型正式变更流程。'},
          {id:'C',text:'客户可以直接修改当前迭代承诺',feedback:'客户可以提出价值需求，但不能绕过产品负责人和团队容量判断。'},
          {id:'D',text:'项目已经进入收尾阶段',feedback:'迭代中期与项目收尾无关，请重新识别题目所处阶段。'}
        ],
        shortExplanation:'题干中的角色、节奏和工件共同确定了敏捷环境。',
        hints:[
          '先根据“团队工作方式”和“时间节奏”判断题目采用哪类方法环境。',
          '看到迭代节奏时，不要直接套用预测型项目的正式变更审批流程。'
        ]
      },
      {
        id:'deep-concept-goal',
        stem:'“当前迭代已经开始”最重要的约束是什么？',
        options:[
          {id:'A',text:'任何新需求都必须永久拒绝',feedback:'保护当前迭代目标不等于永久拒绝新需求。'},
          {id:'B',text:'应保护当前迭代目标，并评估是否安排到后续迭代',correct:true},
          {id:'C',text:'项目经理可以单独调整团队承诺',feedback:'敏捷环境中不能由项目经理单独改变团队承诺与产品优先级。'},
          {id:'D',text:'高价值需求必须立即插入',feedback:'价值很重要，但仍需结合迭代目标和团队容量共同判断。'}
        ],
        shortExplanation:'当前迭代目标需要保持稳定，新需求应先评估再安排。',
        hints:[
          '关注已经开始的迭代需要保护什么，而不是只看需求价值高不高。',
          '区分“暂不插入当前迭代”和“永久拒绝这个需求”。'
        ]
      },
      {
        id:'deep-concept-role',
        stem:'谁应共同评估该需求的价值、优先级和容量影响？',
        options:[
          {id:'A',text:'产品负责人和开发团队',correct:true},
          {id:'B',text:'项目经理单独决定',feedback:'项目经理可促进沟通，但不能替代产品负责人和团队作出价值、容量判断。'},
          {id:'C',text:'客户直接命令开发人员',feedback:'客户提出需求和价值信息，但不应绕过产品负责人和团队协作机制。'},
          {id:'D',text:'变更控制委员会单独审批',feedback:'题干是敏捷迭代环境，首先应由适当敏捷角色评估。'}
        ],
        shortExplanation:'产品负责人负责价值与优先级，团队负责容量和可行性判断。',
        hints:[
          '把“价值与优先级”和“容量与可行性”拆成两项职责。',
          '寻找分别代表产品价值决策和开发容量判断的角色组合。'
        ]
      }
    ],
    reasoningTask:{
      instruction:'拖动卡片，组成完整判断顺序。',
      items:[
        {id:'identify',text:'识别项目环境'},
        {id:'stage',text:'判断当前执行阶段'},
        {id:'roles',text:'明确角色职责'},
        {id:'capacity',text:'评估价值与团队容量'},
        {id:'action',text:'选择适当处理方式'}
      ],
      displayOrder:['capacity','identify','action','roles','stage'],
      correctOrder:['identify','stage','roles','capacity','action'],
      shortExplanation:'你已经形成“识别环境—判断阶段—明确角色—评估约束—选择行动”的完整推理主线。',
      hints:[
        '完整推理应从识别题目情境开始，最后才进入行动选择。',
        '先确定环境和阶段，再明确角色、评估价值与容量，最后决定处理方式。'
      ]
    },
    shortExplanation:'你已经完成一次完整的深度回忆。',
    detailedExplanation:'敏捷变更题不能只看“高价值”就立即插入，也不能机械拒绝。应先识别敏捷环境和迭代阶段，再由产品负责人结合业务价值排序、由团队评估容量和可行性，最后决定是否调整后续待办事项或在不破坏迭代目标的前提下处理。'
  };


  activities['multi-induction-case-01']={
    id:'multi-induction-case-01',
    type:'multi_question_induction',
    title:'从三道变更题归纳环境判断规则',
    sourceQuestions:[
      {
        id:'induction-source-agile',
        stem:'敏捷团队正在两周迭代中，客户提出高价值新功能。最合适的第一步是什么？',
        categoryId:'agile',
        options:[
          {id:'A',text:'立即要求团队加入当前迭代',feedback:'高价值不等于可以绕过产品负责人、迭代目标和团队容量。'},
          {id:'B',text:'与产品负责人和团队评估价值、优先级与容量',correct:true},
          {id:'C',text:'直接提交变更控制委员会',feedback:'题干首先描述的是敏捷迭代环境，不应机械套用预测型流程。'},
          {id:'D',text:'永久拒绝该需求',feedback:'保护当前迭代目标不等于永久拒绝需求。'}
        ],
        shortExplanation:'敏捷环境应由产品负责人和团队共同评估价值、优先级与容量。'
      },
      {
        id:'induction-source-predictive',
        stem:'预测型项目中，客户请求修改已经批准的范围基准。项目经理首先应做什么？',
        categoryId:'predictive',
        options:[
          {id:'A',text:'记录变更请求并开展整体影响评估',correct:true},
          {id:'B',text:'让开发团队直接实施',feedback:'正式基准变化不能绕过记录、影响评估和授权审批。'},
          {id:'C',text:'只调整产品待办列表',feedback:'题干描述的是正式范围基准，不是单纯的敏捷待办排序。'},
          {id:'D',text:'口头通知客户已完成变更',feedback:'没有完成影响评估和授权前，不能承诺变更已经完成。'}
        ],
        shortExplanation:'预测型基准变更应先记录请求并评估范围、进度、成本和风险影响。'
      },
      {
        id:'induction-source-hybrid',
        stem:'团队按迭代交付，但新功能同时影响合同约定的交付范围。最佳处理方式是什么？',
        categoryId:'hybrid',
        options:[
          {id:'A',text:'只让产品负责人调整优先级',feedback:'合同基准影响不能只通过待办列表排序解决。'},
          {id:'B',text:'只提交合同变更审批，不评估团队容量',feedback:'迭代团队的容量和价值排序仍是必要信息。'},
          {id:'C',text:'同时评估价值容量与合同基准影响',correct:true},
          {id:'D',text:'要求团队加班同时完成全部工作',feedback:'加班不能替代价值、容量和治理边界判断。'}
        ],
        shortExplanation:'混合环境需要同时处理敏捷价值容量判断和正式合同基准影响。'
      }
    ],
    classificationTask:{
      instruction:'把三道题目卡片拖入对应的项目环境分类区。',
      categories:[
        {id:'agile',label:'敏捷环境',description:'迭代、产品负责人、团队容量'},
        {id:'predictive',label:'预测型环境',description:'批准基准、正式变更、授权审批'},
        {id:'hybrid',label:'混合环境',description:'迭代交付与正式治理同时存在'}
      ],
      cards:[
        {id:'card-agile',sourceQuestionId:'induction-source-agile',label:'题目 1',text:'迭代中期出现高价值新功能',correctCategoryId:'agile'},
        {id:'card-predictive',sourceQuestionId:'induction-source-predictive',label:'题目 2',text:'请求修改已批准的范围基准',correctCategoryId:'predictive'},
        {id:'card-hybrid',sourceQuestionId:'induction-source-hybrid',label:'题目 3',text:'迭代交付同时影响合同范围',correctCategoryId:'hybrid'}
      ],
      shortExplanation:'你已经从角色、工件、节奏和治理约束中区分了敏捷、预测型与混合环境。'
    },
    orderingTask:{
      instruction:'排列三道题都适用的通用判断规则。',
      items:[
        {id:'identify',text:'识别方法环境与关键工件'},
        {id:'constraint',text:'确认当前承诺、基准或合同约束'},
        {id:'roles',text:'明确负责价值、容量和审批的角色'},
        {id:'impact',text:'评估价值、容量及整体影响'},
        {id:'action',text:'按环境和授权选择处理路径'}
      ],
      displayOrder:['impact','roles','action','identify','constraint'],
      correctOrder:['identify','constraint','roles','impact','action'],
      hints:[
        '通用判断应从识别题目环境开始，最后才进入具体行动。',
        '先识别环境与约束，再明确角色、评估价值容量和整体影响，最后按授权行动。'
      ],
      shortExplanation:'你已经形成“识别环境—确认约束—明确角色—评估影响—选择行动”的可迁移规则。'
    },
    shortExplanation:'你已经从三道相关题目中归纳出可复用的判断框架。',
    detailedExplanation:'多题归纳的重点不是记住三个答案，而是把敏捷、预测型和混合环境中的共同判断过程抽取出来：先识别环境与工件，再确认承诺或基准约束，明确价值、容量和审批角色，评估影响后选择适当处理路径。'
  };


  activities['knowledge-graph-case-01']={
    id:'knowledge-graph-case-01',
    type:'knowledge_graph',
    title:'变更判断知识图谱',
    graph:{
      nodes:[
        {id:'environment',label:'项目环境',x:50,y:10,kind:'root'},
        {id:'agile',label:'敏捷迭代',x:17,y:37},
        {id:'predictive',label:'正式基准',x:50,y:37},
        {id:'hybrid',label:'混合治理',x:83,y:37},
        {id:'roles',label:'关键角色',x:18,y:76},
        {id:'impact',label:'影响评估',x:50,y:76},
        {id:'action',label:'处理行动',x:82,y:76}
      ],
      edges:[
        {id:'edge-environment-agile',from:'environment',to:'agile',relation:'可表现为',labelX:33,labelY:21},
        {id:'edge-environment-predictive',from:'environment',to:'predictive',relation:'可表现为',labelX:50,labelY:21},
        {id:'edge-environment-hybrid',from:'environment',to:'hybrid',relation:'可表现为',labelX:67,labelY:21},
        {id:'edge-agile-roles',from:'agile',to:'roles',relation:'强调',labelX:17,labelY:57},
        {id:'edge-predictive-impact',from:'predictive',to:'impact',relation:'需要',labelX:50,labelY:57},
        {id:'edge-hybrid-impact',from:'hybrid',to:'impact',relation:'同时考虑',labelX:67,labelY:57},
        {id:'edge-impact-action',from:'impact',to:'action',relation:'支持',labelX:66,labelY:76}
      ]
    },
    missingNodeTasks:[
      {
        id:'missing-impact',
        targetNodeId:'impact',
        instruction:'补全图谱中缺失的知识点。',
        options:[
          {id:'roles',text:'关键角色'},
          {id:'impact',text:'影响评估'},
          {id:'backlog',text:'产品待办列表'},
          {id:'approval',text:'最终批准'}
        ],
        correctOptionId:'impact',
        shortExplanation:'无论采用预测型还是混合治理，都需要评估范围、进度、成本、风险及团队容量等影响。',
        hints:[
          '这个知识点位于正式基准与混合治理之后，处理行动之前。',
          '它回答的是“变更会带来哪些后果”，而不是“由谁决定”。'
        ]
      }
    ],
    relationTasks:[
      {
        id:'relation-agile-roles',
        edgeId:'edge-agile-roles',
        instruction:'敏捷迭代与关键角色之间最合适的关系是什么？',
        options:[
          {id:'requires-approval',text:'必须提交正式审批'},
          {id:'emphasizes',text:'强调角色协作'},
          {id:'replaces',text:'完全替代'},
          {id:'ignores',text:'可以忽略'}
        ],
        correctOptionId:'emphasizes',
        correctRelation:'强调',
        shortExplanation:'敏捷变更判断强调产品负责人、团队及相关方之间的职责协作。',
        hints:[
          '敏捷环境并不意味着没有职责边界。',
          '产品负责人负责价值排序，团队负责容量和可行性判断。'
        ]
      },
      {
        id:'relation-predictive-impact',
        edgeId:'edge-predictive-impact',
        instruction:'正式基准与影响评估之间应使用哪一种关系？',
        options:[
          {id:'skips',text:'可以跳过'},
          {id:'requires',text:'需要'},
          {id:'conflicts',text:'必然冲突'},
          {id:'finishes',text:'已经完成'}
        ],
        correctOptionId:'requires',
        correctRelation:'需要',
        shortExplanation:'修改已批准的基准前，需要记录请求并开展整体影响评估。',
        hints:[
          '批准基准发生变化时，不能直接实施。',
          '先评估范围、进度、成本和风险，再进入授权决定。'
        ]
      }
    ],
    errorConnectionTasks:[
      {
        id:'error-connection-01',
        instruction:'下面的知识图谱中有一条错误连接，请点击它。',
        candidateEdges:[
          {id:'candidate-environment-agile',from:'environment',to:'agile',relation:'可表现为'},
          {id:'candidate-environment-predictive',from:'environment',to:'predictive',relation:'可表现为'},
          {id:'candidate-environment-hybrid',from:'environment',to:'hybrid',relation:'可表现为'},
          {id:'candidate-agile-roles',from:'agile',to:'roles',relation:'强调'},
          {id:'candidate-predictive-impact',from:'predictive',to:'impact',relation:'可以跳过'},
          {id:'candidate-hybrid-impact',from:'hybrid',to:'impact',relation:'同时考虑'},
          {id:'candidate-impact-action',from:'impact',to:'action',relation:'支持'}
        ],
        incorrectEdgeId:'candidate-predictive-impact',
        shortExplanation:'“正式基准 → 可以跳过 → 影响评估”是错误连接。正式基准变更必须先完成影响评估。',
        hints:[
          '寻找一条会绕过正式治理步骤的连接。',
          '当批准基准受到影响时，影响评估不能省略。'
        ]
      }
    ],
    shortExplanation:'你已经完成知识点补全、关系判断和错误连接识别。',
    detailedExplanation:'固定小图谱用于把项目环境、关键角色、影响评估和处理行动连接起来。敏捷环境强调价值、职责和团队容量；预测型环境强调基准、影响评估和授权；混合环境需要同时考虑两套约束。'
  };

  const nodeActivityIds={
    deepRecall:['deep-recall-case-01'],
    multiQuestionInduction:['multi-induction-case-01'],
    knowledgeGraph:['knowledge-graph-case-01'],
    environmentKeywords:addKeywordSet('env-keyword',[
      {
        segments:[
          {text:'一个 '},{text:'敏捷团队',target:true},{text:' 正在进行 '},{text:'两周迭代',target:true},{text:'，客户提出新的高价值功能。'}
        ],
        explanation:'“敏捷团队”和“迭代”直接确定了敏捷方法环境。'
      },
      {
        segments:[
          {text:'项目已批准 '},{text:'范围基准',target:true},{text:'，客户提交了 '},{text:'正式变更请求',target:true},{text:'。'}
        ],
        explanation:'“范围基准”和“正式变更请求”提示应考虑预测型整体变更控制。'
      },
      {
        segments:[
          {text:'软件团队按 '},{text:'迭代',target:true},{text:' 交付，但合同范围受 '},{text:'正式基准',target:true},{text:' 约束。'}
        ],
        explanation:'题干同时出现迭代和正式基准，说明这是混合治理环境。'
      },
      {
        segments:[
          {text:'产品负责人正在调整 '},{text:'产品待办列表',target:true},{text:' 的顺序，以提升 '},{text:'业务价值',target:true},{text:'。'}
        ],
        explanation:'产品待办列表与价值排序是敏捷环境的重要线索。'
      },
      {
        segments:[
          {text:'变更将影响批准的 '},{text:'成本基准',target:true},{text:' 和 '},{text:'进度基准',target:true},{text:'。'}
        ],
        explanation:'影响正式基准时，需要进入规定的影响评估和审批流程。'
      }
    ]),

    environmentPractice:addChoiceSet('env-choice',[
      {
        stem:'题干出现“迭代中期”和“产品负责人”，首先应识别为什么环境？',
        options:[
          {id:'A',text:'敏捷环境',correct:true},
          {id:'B',text:'纯预测型环境'},
          {id:'C',text:'采购审计环境'},
          {id:'D',text:'项目收尾环境'}
        ],
        explanation:'迭代和产品负责人是明确的敏捷方法线索。'
      },
      {
        stem:'哪组词最能提示题目采用预测型正式变更流程？',
        options:[
          {id:'A',text:'待办列表、迭代评审'},
          {id:'B',text:'范围基准、变更请求',correct:true},
          {id:'C',text:'每日站会、回顾会'},
          {id:'D',text:'用户故事、故事点'}
        ],
        explanation:'批准的基准和正式变更请求通常对应预测型治理。'
      },
      {
        stem:'题干同时出现“两周迭代”和“合同基准”，最合理的判断是什么？',
        options:[
          {id:'A',text:'只按敏捷处理'},
          {id:'B',text:'只按预测型处理'},
          {id:'C',text:'先识别混合治理边界',correct:true},
          {id:'D',text:'忽略合同约束'}
        ],
        explanation:'混合环境需要同时识别敏捷交付方式和正式治理边界。'
      },
      {
        stem:'“产品待办列表优先级发生调整”主要说明什么？',
        options:[
          {id:'A',text:'价值排序正在变化',correct:true},
          {id:'B',text:'范围基准已自动修改'},
          {id:'C',text:'团队必须立即加班'},
          {id:'D',text:'项目应立即终止'}
        ],
        explanation:'产品待办列表反映工作价值与优先级，不等同于正式基准自动变化。'
      },
      {
        stem:'题干没有方法名称时，最先应做什么？',
        options:[
          {id:'A',text:'默认提交 CCB'},
          {id:'B',text:'默认交给产品负责人'},
          {id:'C',text:'从角色、工件和节奏线索识别环境',correct:true},
          {id:'D',text:'直接选择最强硬的选项'}
        ],
        explanation:'题目常通过角色、工件、节奏与治理词汇间接描述方法环境。'
      }
    ]),

    roleMatching:addMatchingSet('role-match',[
      {pairs:[
        {id:'po',left:'产品负责人',right:'管理产品待办列表和价值优先级'},
        {id:'team',left:'开发团队',right:'评估工作量并完成迭代承诺'},
        {id:'stakeholder',left:'相关方',right:'表达业务需求和反馈'}
      ]},
      {pairs:[
        {id:'pm',left:'项目经理',right:'整合信息并促进适当治理'},
        {id:'ccb',left:'变更控制委员会',right:'审查正式基准变更'},
        {id:'sponsor',left:'项目发起人',right:'提供高层支持与关键决策'}
      ]},
      {pairs:[
        {id:'sm',left:'敏捷教练 / Scrum Master',right:'促进团队协作并移除障碍'},
        {id:'po2',left:'产品负责人',right:'决定待办事项价值顺序'},
        {id:'dev',left:'开发人员',right:'判断技术实现和容量影响'}
      ]},
      {pairs:[
        {id:'customer',left:'客户',right:'提出业务价值与验收反馈'},
        {id:'team2',left:'团队',right:'提供工作量和可行性判断'},
        {id:'po3',left:'产品负责人',right:'综合价值后调整优先级'}
      ]},
      {pairs:[
        {id:'owner',left:'风险责任人',right:'落实约定的风险应对'},
        {id:'pm2',left:'项目经理',right:'协调跨领域影响评估'},
        {id:'board',left:'治理机构',right:'按授权边界作出正式决定'}
      ]}
    ]),

    processOrder:addChoiceSet('process-choice',[
      {
        stem:'敏捷迭代中期出现高价值新功能，首先应怎么做？',
        options:[
          {id:'A',text:'立即要求团队加入当前迭代'},
          {id:'B',text:'与产品负责人和团队评估价值、优先级与容量',correct:true},
          {id:'C',text:'直接拒绝所有新需求'},
          {id:'D',text:'跳过评估直接提交 CCB'}
        ],
        explanation:'先由适当角色共同评估价值和容量，再决定待办列表与迭代安排。'
      },
      {
        stem:'预测型项目中的变更可能影响范围基准，首先应做什么？',
        options:[
          {id:'A',text:'直接实施'},
          {id:'B',text:'记录请求并评估整体影响',correct:true},
          {id:'C',text:'只咨询开发团队'},
          {id:'D',text:'口头同意客户'}
        ],
        explanation:'正式变更应先记录并评估范围、进度、成本、风险等影响。'
      },
      {
        stem:'团队认为新需求会破坏当前迭代目标，下一步最合适的是？',
        options:[
          {id:'A',text:'强制团队接受'},
          {id:'B',text:'由产品负责人结合价值和容量决定安排',correct:true},
          {id:'C',text:'项目经理单独改优先级'},
          {id:'D',text:'取消整个产品'}
        ],
        explanation:'产品负责人负责价值优先级，团队提供容量与可行性信息。'
      },
      {
        stem:'混合项目中的请求既影响待办列表又可能影响合同基准，应怎么做？',
        options:[
          {id:'A',text:'只调整待办列表'},
          {id:'B',text:'只走合同审批'},
          {id:'C',text:'同时开展价值容量评估和正式基准影响评估',correct:true},
          {id:'D',text:'让团队自行决定'}
        ],
        explanation:'混合治理需要同时处理敏捷优先级与正式基准边界。'
      },
      {
        stem:'处理变更题时，最稳定的第一步判断框架是什么？',
        options:[
          {id:'A',text:'先看答案长短'},
          {id:'B',text:'先识别环境、角色和受影响约束',correct:true},
          {id:'C',text:'总是优先拒绝变更'},
          {id:'D',text:'总是要求加班'}
        ],
        explanation:'环境、角色和约束决定后续应使用的处理流程。'
      }
    ]),

    structureKeywords:addKeywordSet('structure-keyword',[
      {
        segments:[
          {text:'迭代进行到 '},{text:'一半',target:true},{text:'，客户提出 '},{text:'高价值功能',target:true},{text:'，团队表示 '},{text:'当前承诺可能无法完成',target:true},{text:'。'}
        ],
        explanation:'时间点、价值和当前承诺共同构成核心冲突。',
        hints:['先分别寻找“发生在什么时候”“需求价值如何”“当前承诺受到什么影响”三个方向。']
      },
      {
        segments:[
          {text:'变更请求会增加 '},{text:'20 万元成本',target:true},{text:'，推迟 '},{text:'关键里程碑',target:true},{text:'，并引入新的 '},{text:'合规风险',target:true},{text:'。'}
        ],
        explanation:'成本、进度和风险都是正式影响评估的核心维度。',
        hints:['把题干中的数字、日期变化和不确定后果分别对应到成本、进度与风险。']
      },
      {
        segments:[
          {text:'客户说功能很紧急，但 '},{text:'产品负责人尚未排序',target:true},{text:'，团队也 '},{text:'没有评估工作量',target:true},{text:'。'}
        ],
        explanation:'缺少价值排序与工作量评估，不能直接承诺实施。',
        hints:['重点寻找题干中“谁还没有作出价值判断”和“哪项工作量信息仍然缺失”。']
      },
      {
        segments:[
          {text:'项目经理拥有 '},{text:'有限变更授权',target:true},{text:'，超过阈值必须提交 '},{text:'治理委员会',target:true},{text:'。'}
        ],
        explanation:'授权边界决定由谁作出最终决定。',
        hints:['先找管理员或项目经理可以自行决定的范围，再找超过范围后需要提交给谁。']
      },
      {
        segments:[
          {text:'新需求能够提升收益，但会影响 '},{text:'迭代目标',target:true},{text:' 和 '},{text:'合同交付日期',target:true},{text:'。'}
        ],
        explanation:'这是价值与双重约束之间的权衡，不能只看收益。',
        hints:['除了收益，还要同时标出受到影响的内部迭代承诺和外部合同日期。']
      }
    ]),

    trapPractice:addChoiceSet('trap-choice',[
      {
        stem:'“要求团队加班，同时完成新功能和原计划工作”属于什么陷阱？',
        options:[
          {id:'A',text:'用命令控制代替价值与容量协商',correct:true},
          {id:'B',text:'尊重团队自组织'},
          {id:'C',text:'正确保护迭代目标'},
          {id:'D',text:'充分评估影响'}
        ],
        explanation:'加班没有解决优先级和容量冲突。'
      },
      {
        stem:'“只要客户提出，就立即加入当前迭代”忽略了什么？',
        options:[
          {id:'A',text:'价值、优先级、容量和迭代目标',correct:true},
          {id:'B',text:'客户的存在'},
          {id:'C',text:'团队名称'},
          {id:'D',text:'会议室安排'}
        ],
        explanation:'客户需求需要进入透明的价值和容量判断，而不是自动插入。'
      },
      {
        stem:'敏捷题中机械选择“提交 CCB”最可能犯了什么错误？',
        options:[
          {id:'A',text:'忽略方法环境',correct:true},
          {id:'B',text:'忽略题目字体'},
          {id:'C',text:'过度关注价值'},
          {id:'D',text:'尊重治理边界'}
        ],
        explanation:'未影响正式治理基准时，不应机械套用预测型 CCB。'
      },
      {
        stem:'“为了保护计划，拒绝一切变更”为什么通常不是最佳答案？',
        options:[
          {id:'A',text:'它忽略了变更可能带来的价值，需要先评估',correct:true},
          {id:'B',text:'所有变更都必须立即执行'},
          {id:'C',text:'计划永远不重要'},
          {id:'D',text:'团队不能参与判断'}
        ],
        explanation:'合理做法是评估价值与影响，而不是自动接受或自动拒绝。'
      },
      {
        stem:'“项目经理独自决定产品待办列表顺序”主要错在哪里？',
        options:[
          {id:'A',text:'越过产品负责人的价值排序职责',correct:true},
          {id:'B',text:'没有召开 CCB'},
          {id:'C',text:'没有增加成本'},
          {id:'D',text:'没有延长迭代'}
        ],
        explanation:'产品负责人对产品价值和待办列表优先级负责。'
      }
    ]),

    applicationPractice:addChoiceSet('application-choice',[
      {
        stem:'客户在迭代中期提出紧急功能，团队认为会影响迭代目标。最佳行动是？',
        options:[
          {id:'A',text:'项目经理直接替换当前工作'},
          {id:'B',text:'与产品负责人和团队讨论价值、优先级与容量',correct:true},
          {id:'C',text:'立即拒绝客户'},
          {id:'D',text:'不评估直接加班'}
        ],
        explanation:'通过适当角色共同评估，再决定当前或后续迭代安排。'
      },
      {
        stem:'一个低价值请求会占用大量团队容量，最合适的处理是什么？',
        options:[
          {id:'A',text:'因为客户提出所以立即实施'},
          {id:'B',text:'由产品负责人重新比较价值与机会成本',correct:true},
          {id:'C',text:'项目经理秘密删除'},
          {id:'D',text:'要求团队无偿加班'}
        ],
        explanation:'待办列表排序应比较价值、成本、风险和机会成本。'
      },
      {
        stem:'正式变更获批后，项目经理下一步应做什么？',
        options:[
          {id:'A',text:'更新受影响计划和沟通相关方',correct:true},
          {id:'B',text:'保留旧基准不变'},
          {id:'C',text:'只通知客户'},
          {id:'D',text:'重新提交同一请求'}
        ],
        explanation:'获批变更需要更新相应文件、基准和沟通。'
      },
      {
        stem:'团队发现新需求有重大技术风险，应如何支持决策？',
        options:[
          {id:'A',text:'隐瞒风险以便快速实施'},
          {id:'B',text:'提供风险、工作量和方案信息供优先级决策',correct:true},
          {id:'C',text:'由客户直接安排开发人员'},
          {id:'D',text:'跳过评估'}
        ],
        explanation:'团队应提供透明的技术与容量信息。'
      },
      {
        stem:'混合项目中，小变更在授权阈值内且不影响正式基准，最合理的是？',
        options:[
          {id:'A',text:'按授权范围快速处理并保留记录',correct:true},
          {id:'B',text:'所有变更都提交最高治理机构'},
          {id:'C',text:'不记录直接实施'},
          {id:'D',text:'自动拒绝'}
        ],
        explanation:'应在明确授权边界内高效处理，同时保持可追溯性。'
      }
    ]),

    reviewMatching:addMatchingSet('review-match',[
      {pairs:[
        {id:'agile',left:'敏捷新需求',right:'进入待办列表并进行价值排序'},
        {id:'predictive',left:'正式基准变更',right:'记录、评估并按授权审批'},
        {id:'hybrid',left:'混合环境变更',right:'同时识别交付方式和治理边界'}
      ]},
      {pairs:[
        {id:'value',left:'业务价值',right:'影响待办列表优先级'},
        {id:'capacity',left:'团队容量',right:'影响当前可承诺工作量'},
        {id:'baseline',left:'正式基准',right:'决定是否进入变更控制'}
      ]},
      {pairs:[
        {id:'po',left:'产品负责人',right:'价值与优先级'},
        {id:'team',left:'团队',right:'工作量、技术和容量'},
        {id:'governance',left:'治理机构',right:'超出授权边界的正式决定'}
      ]},
      {pairs:[
        {id:'accept',left:'自动接受变更',right:'忽略容量和约束'},
        {id:'reject',left:'自动拒绝变更',right:'忽略潜在业务价值'},
        {id:'assess',left:'先评估再决定',right:'兼顾价值、影响和治理'}
      ]},
      {pairs:[
        {id:'first',left:'第一步',right:'识别环境、角色和约束'},
        {id:'second',left:'第二步',right:'评估价值、影响和容量'},
        {id:'third',left:'第三步',right:'按职责与授权执行并更新记录'}
      ]}
    ]),

    hybridPractice:addChoiceSet('hybrid-choice',[
      {
        stem:'混合项目采用迭代交付，但合同范围由正式基准控制。客户提出新功能，最佳做法是？',
        options:[
          {id:'A',text:'只调整待办列表'},
          {id:'B',text:'只提交 CCB'},
          {id:'C',text:'评估价值容量，并判断是否影响合同基准',correct:true},
          {id:'D',text:'要求团队全部完成'}
        ],
        explanation:'混合环境要同时处理敏捷价值排序和正式治理边界。'
      },
      {
        stem:'某项需求可以在团队授权内调整，但不影响合同基准，应优先怎么做？',
        options:[
          {id:'A',text:'按团队和产品负责人的既定机制处理并记录',correct:true},
          {id:'B',text:'一律提交最高层审批'},
          {id:'C',text:'不记录'},
          {id:'D',text:'拒绝需求'}
        ],
        explanation:'授权范围内可保持敏捷效率，但仍需留痕。'
      },
      {
        stem:'新功能会改变合同交付物，哪项动作不可缺少？',
        options:[
          {id:'A',text:'只更新产品待办列表'},
          {id:'B',text:'评估并按正式治理流程处理合同基准影响',correct:true},
          {id:'C',text:'只召开站会'},
          {id:'D',text:'由开发人员口头决定'}
        ],
        explanation:'合同交付物变化通常触及正式治理边界。'
      },
      {
        stem:'混合环境题中，最佳答案通常具有什么特征？',
        options:[
          {id:'A',text:'只强调敏捷'},
          {id:'B',text:'只强调审批'},
          {id:'C',text:'明确区分价值排序与正式授权边界',correct:true},
          {id:'D',text:'忽略角色职责'}
        ],
        explanation:'混合题的关键是让两套机制在清晰边界内协同。'
      },
      {
        stem:'迭代计划可调整，但发布日期受监管承诺约束，首先应关注什么？',
        options:[
          {id:'A',text:'只看团队偏好'},
          {id:'B',text:'同时评估迭代调整和监管日期影响',correct:true},
          {id:'C',text:'取消监管承诺'},
          {id:'D',text:'隐藏变更'}
        ],
        explanation:'局部敏捷调整不能忽略外部正式约束。'
      }
    ]),

    integratedPractice:addChoiceSet('integrated-choice',[
      {
        stem:'面对任何“新需求 / 变更”题，最稳健的判断主线是？',
        options:[
          {id:'A',text:'识别环境与角色 → 评估价值和影响 → 按授权执行',correct:true},
          {id:'B',text:'立即接受 → 再考虑影响'},
          {id:'C',text:'立即拒绝 → 保持原计划'},
          {id:'D',text:'总是提交最高层审批'}
        ],
        explanation:'这条主线能够迁移到敏捷、预测型和混合环境。'
      },
      {
        stem:'哪项信息最能帮助排除“立即实施”类选项？',
        options:[
          {id:'A',text:'尚未评估价值、容量或正式影响',correct:true},
          {id:'B',text:'选项文字较短'},
          {id:'C',text:'客户职位较高'},
          {id:'D',text:'题目出现在最后一页'}
        ],
        explanation:'缺少关键评估时，立即实施通常越过必要判断。'
      },
      {
        stem:'哪项信息最能帮助排除“直接拒绝”类选项？',
        options:[
          {id:'A',text:'请求可能具有显著业务价值但尚未评估',correct:true},
          {id:'B',text:'团队已经下班'},
          {id:'C',text:'选项中没有数字'},
          {id:'D',text:'项目经理不喜欢变更'}
        ],
        explanation:'价值尚未评估时，不应直接拒绝。'
      },
      {
        stem:'角色判断和流程判断发生冲突时，应优先检查什么？',
        options:[
          {id:'A',text:'题干中的授权边界与方法环境',correct:true},
          {id:'B',text:'答案字数'},
          {id:'C',text:'选项排列顺序'},
          {id:'D',text:'个人习惯'}
        ],
        explanation:'授权与环境决定角色能否作出该决定以及采用何种流程。'
      },
      {
        stem:'一个优秀答案最常同时满足哪些条件？',
        options:[
          {id:'A',text:'尊重角色、评估影响、保护价值并遵守治理',correct:true},
          {id:'B',text:'速度最快且无需记录'},
          {id:'C',text:'由项目经理独自决定'},
          {id:'D',text:'完全不允许变化'}
        ],
        explanation:'最佳实践通常兼顾价值、协作、影响和治理。'
      }
    ]),

    relationMatching:addMatchingSet('relation-match',[
      {pairs:[
        {id:'environment',left:'方法环境',right:'决定使用哪套工作与治理机制'},
        {id:'role',left:'角色职责',right:'决定谁提供信息和作出决定'},
        {id:'constraint',left:'项目约束',right:'决定必须评估哪些影响'}
      ]},
      {pairs:[
        {id:'backlog',left:'产品待办列表',right:'承载敏捷工作优先级'},
        {id:'iteration',left:'迭代目标',right:'保护当前短周期承诺'},
        {id:'baseline',left:'项目基准',right:'承载正式批准的计划'}
      ]},
      {pairs:[
        {id:'value',left:'价值',right:'为什么值得做'},
        {id:'impact',left:'影响',right:'做了会改变什么'},
        {id:'authority',left:'授权',right:'谁有权批准或调整'}
      ]},
      {pairs:[
        {id:'identify',left:'识别',right:'找到环境、角色和约束'},
        {id:'assess',left:'评估',right:'比较价值、成本、风险和容量'},
        {id:'act',left:'执行',right:'按职责和授权更新计划'}
      ]},
      {pairs:[
        {id:'agile',left:'敏捷路径',right:'待办列表与价值排序'},
        {id:'predictive',left:'预测型路径',right:'影响评估与整体变更控制'},
        {id:'hybrid',left:'混合路径',right:'按治理边界组合两种机制'}
      ]}
    ]),

    processExplain:addOpenTextSet('process-open',[
      {
        prompt:'在敏捷迭代已经开始后，面对客户提出的新需求，你认为应按什么顺序处理？',
        minLength:1,
        maxLength:300,
        evaluationMode:'show_reference',
        referenceAnswer:'先识别当前处于敏捷迭代环境并保护迭代目标；再由产品负责人判断业务价值和优先级，由团队评估工作量与容量；最后决定将需求安排到后续待办事项，或在不破坏当前目标且获得团队共同确认的情况下调整。',
        placeholder:'写下你的处理思路即可，不限制表达长度。',
        shortExplanation:'你的思路已提交，下面展示一份参考答案。',
        requiredConcepts:[
          {id:'iteration-goal',acceptedExpressions:['保护迭代目标','保持迭代目标','保护冲刺目标','避免影响当前迭代目标'],missingHint:'请考虑当前迭代目标和团队承诺是否应保持稳定。'},
          {id:'team-capacity',acceptedExpressions:['团队容量','当前容量已满','没有剩余容量','评估工作量','评估容量'],missingHint:'请考虑团队当前能够承担的工作量。'},
          {id:'product-backlog',acceptedExpressions:['产品待办列表','待办列表排序','产品负责人调整优先级','由产品负责人决定优先级'],missingHint:'请考虑新需求应由谁管理，以及通常应放在哪里。'}
        ],
        explanation:'敏捷团队应保护当前迭代目标，由产品负责人结合业务价值管理产品待办列表，并与团队共同评估容量后安排需求。'
      },
      {
        prompt:'预测型项目中的变更可能影响范围、进度和成本基准，为什么不能直接实施？',
        requiredConcepts:[
          {id:'record',acceptedExpressions:['记录变更请求','正式记录','登记变更'],missingHint:'请考虑变更是否需要先形成可追溯记录。'},
          {id:'impact',acceptedExpressions:['评估影响','影响评估','分析范围进度成本','综合评估'],missingHint:'请考虑实施前需要分析哪些项目影响。'},
          {id:'approval',acceptedExpressions:['审批','按授权批准','变更控制委员会','正式批准'],missingHint:'请考虑谁有权批准对正式基准的修改。'}
        ],
        explanation:'正式基准变更应先记录请求，综合评估范围、进度、成本和风险影响，再按授权流程审批。'
      },
      {
        prompt:'混合型项目同时采用迭代交付和合同基准时，处理新需求需要兼顾哪些方面？',
        requiredConcepts:[
          {id:'value',acceptedExpressions:['业务价值','价值排序','优先级'],missingHint:'请考虑敏捷交付侧如何判断需求价值。'},
          {id:'capacity',acceptedExpressions:['团队容量','工作量','迭代容量'],missingHint:'请考虑当前团队是否能够承载该需求。'},
          {id:'baseline',acceptedExpressions:['合同基准','正式基准','治理边界','正式审批'],missingHint:'请考虑该需求是否触及合同或正式治理边界。'}
        ],
        explanation:'混合治理既要进行敏捷侧的价值与容量判断，也要识别需求是否影响合同或其他正式基准。'
      },
      {
        prompt:'产品负责人、开发团队和项目经理在敏捷变更判断中分别提供什么价值？',
        requiredConcepts:[
          {id:'po',acceptedExpressions:['产品负责人负责价值','产品负责人排序','产品负责人管理待办列表','价值优先级'],missingHint:'请说明产品负责人对价值与优先级的职责。'},
          {id:'team',acceptedExpressions:['团队评估工作量','团队提供容量','开发团队判断技术可行性','技术风险'],missingHint:'请说明开发团队提供哪些工作量或技术信息。'},
          {id:'pm',acceptedExpressions:['项目经理协调','项目经理整合信息','促进沟通','协调治理'],missingHint:'请说明项目经理如何促进信息整合与协作。'}
        ],
        explanation:'产品负责人负责价值与排序，团队提供容量和技术判断，项目经理促进协作并确保适当治理。'
      },
      {
        prompt:'面对一道变更情境题，为什么应先识别项目环境、角色和约束，再选择处理方式？',
        requiredConcepts:[
          {id:'environment',acceptedExpressions:['项目环境','方法环境','敏捷预测型混合','识别环境'],missingHint:'请说明方法环境会决定什么。'},
          {id:'role',acceptedExpressions:['角色职责','谁负责','授权边界'],missingHint:'请说明角色与授权为何影响决策。'},
          {id:'constraint',acceptedExpressions:['约束','范围进度成本','容量','基准影响'],missingHint:'请说明受影响约束为何需要先被识别。'}
        ],
        explanation:'环境决定适用机制，角色和授权决定谁提供信息或作出决定，约束决定需要评估哪些影响。'
      }
    ]),

    scenarioExplain:addOpenTextSet('scenario-open',[
      {
        prompt:'客户提出高价值需求，但团队容量不足。请说明项目团队应如何处理以及为什么。',
        requiredConcepts:[
          {id:'assess',acceptedExpressions:['评估价值','评估优先级','比较价值'],missingHint:'请考虑是否需要先判断需求价值和优先级。'},
          {id:'capacity',acceptedExpressions:['团队容量','评估工作量','容量不足'],missingHint:'请考虑团队当前承载能力。'},
          {id:'po',acceptedExpressions:['产品负责人','待办列表','调整优先级'],missingHint:'请考虑由谁管理需求优先级和待办列表。'}
        ],
        explanation:'应由产品负责人和团队共同评估价值、优先级、工作量与容量，再决定放入当前或后续迭代。'
      },
      {
        prompt:'为什么“为了保护计划而拒绝所有变更”通常不是最佳处理方式？',
        requiredConcepts:[
          {id:'value',acceptedExpressions:['业务价值','潜在价值','价值可能很高'],missingHint:'请考虑变更是否可能带来新的业务价值。'},
          {id:'assess',acceptedExpressions:['先评估','评估影响','分析后决定'],missingHint:'请考虑在接受或拒绝之前需要进行什么判断。'},
          {id:'balance',acceptedExpressions:['平衡价值和影响','兼顾约束','权衡'],missingHint:'请说明决策需要平衡哪些因素。'}
        ],
        explanation:'变更可能带来价值，应先评估价值与影响，在约束和治理边界内作出权衡，而不是自动拒绝。'
      },
      {
        prompt:'为什么项目经理不应独自决定产品待办列表的优先级？',
        requiredConcepts:[
          {id:'po',acceptedExpressions:['产品负责人负责','产品负责人职责','由产品负责人排序'],missingHint:'请指出谁对产品待办列表价值排序负责。'},
          {id:'value',acceptedExpressions:['业务价值','价值优先级','产品价值'],missingHint:'请说明排序主要依据什么。'},
          {id:'collaboration',acceptedExpressions:['团队协作','提供容量信息','共同评估'],missingHint:'请考虑其他角色应提供哪些协作信息。'}
        ],
        explanation:'产品负责人对产品价值和待办列表排序负责，团队提供容量与技术信息，项目经理应促进协作而非越权决定。'
      },
      {
        prompt:'正式变更批准后，为什么还必须更新计划、基准并沟通相关方？',
        requiredConcepts:[
          {id:'alignment',acceptedExpressions:['保持一致','更新计划','更新基准'],missingHint:'请考虑批准后的正式计划如何保持一致。'},
          {id:'communication',acceptedExpressions:['通知相关方','沟通','同步信息'],missingHint:'请考虑哪些人需要知道变化。'},
          {id:'traceability',acceptedExpressions:['可追溯','记录','留痕'],missingHint:'请考虑变更过程为何需要保留记录。'}
        ],
        explanation:'获批变更必须同步到受影响的计划和基准，向相关方沟通，并保持决策和实施过程可追溯。'
      },
      {
        prompt:'混合型项目中的小变更在授权阈值内且不影响正式基准，应该如何处理？',
        requiredConcepts:[
          {id:'authority',acceptedExpressions:['授权范围内','授权阈值','按授权处理'],missingHint:'请考虑当前角色是否拥有处理权限。'},
          {id:'agile',acceptedExpressions:['快速处理','敏捷机制','待办列表调整'],missingHint:'请考虑如何保持迭代交付效率。'},
          {id:'record',acceptedExpressions:['保留记录','留痕','记录变更'],missingHint:'请考虑即使无需高层审批是否仍需可追溯。'}
        ],
        explanation:'在明确授权范围内可以快速处理，但仍应保留记录；一旦触及正式基准，再进入相应治理流程。'
      }
    ]),

    activeRecall:addMemorySet('active-memory',[
      {
        pairs:[
          {id:'po-backlog',left:'产品负责人',right:'管理产品待办列表和价值优先级'},
          {id:'team-capacity',left:'开发团队',right:'评估工作量、技术风险和容量'},
          {id:'iteration-goal',left:'迭代目标',right:'保护当前短周期的共同承诺'},
          {id:'new-demand',left:'新需求',right:'进入待办列表并在适当时点安排'}
        ],
        cardOrder:['po-backlog:left','team-capacity:right','iteration-goal:left','new-demand:right','team-capacity:left','po-backlog:right','new-demand:left','iteration-goal:right'],
        explanation:'敏捷变更判断需要把价值排序、团队容量、迭代目标和需求安排连接起来。'
      }
    ]),

    integratedRecall:addMemorySet('integrated-memory',[
      {
        pairs:[
          {id:'identify',left:'识别',right:'判断方法环境、角色和约束'},
          {id:'assess',left:'评估',right:'比较价值、影响、风险与容量'},
          {id:'authorize',left:'授权',right:'确认谁有权批准或调整'},
          {id:'update',left:'更新',right:'同步计划、基准、沟通和记录'},
          {id:'hybrid',left:'混合治理',right:'按边界衔接敏捷调整与正式流程'}
        ],
        cardOrder:['assess:left','identify:right','hybrid:left','update:right','authorize:left','assess:right','identify:left','hybrid:right','update:left','authorize:right'],
        explanation:'综合规则由识别、评估、授权、更新和治理边界共同构成。'
      }
    ]),

    stageChallenge:addChoiceSet('challenge-choice',[
      {
        stem:'迭代中期出现高价值需求，团队容量不足。最佳行动是什么？',
        options:[
          {id:'A',text:'要求团队加班'},
          {id:'B',text:'由产品负责人和团队评估优先级与容量后安排',correct:true},
          {id:'C',text:'直接拒绝'},
          {id:'D',text:'不看环境直接提交 CCB'}
        ],
        explanation:'敏捷环境中应通过价值排序与容量协商处理。'
      },
      {
        stem:'预测型项目中的请求会影响范围与成本基准。最佳下一步是？',
        options:[
          {id:'A',text:'立即实施'},
          {id:'B',text:'记录并开展综合影响评估',correct:true},
          {id:'C',text:'只调整待办列表'},
          {id:'D',text:'由团队口头批准'}
        ],
        explanation:'正式基准变化需先完成影响评估。'
      },
      {
        stem:'混合项目中的新功能影响合同交付物，同时具有高价值。最佳做法是？',
        options:[
          {id:'A',text:'只按价值排序'},
          {id:'B',text:'只按合同审批'},
          {id:'C',text:'同时评估价值容量与合同基准影响',correct:true},
          {id:'D',text:'强制团队完成'}
        ],
        explanation:'两种治理机制应在明确边界内共同作用。'
      },
      {
        stem:'哪项是处理变更时最不可靠的做法？',
        options:[
          {id:'A',text:'识别环境与角色'},
          {id:'B',text:'评估价值和影响'},
          {id:'C',text:'不分析题干，固定选择某一种流程',correct:true},
          {id:'D',text:'检查授权边界'}
        ],
        explanation:'机械套用单一流程会忽略题目环境。'
      },
      {
        stem:'完整判断主线的正确顺序是什么？',
        options:[
          {id:'A',text:'执行 → 识别 → 评估'},
          {id:'B',text:'识别 → 评估 → 按授权执行',correct:true},
          {id:'C',text:'拒绝 → 记录 → 解释'},
          {id:'D',text:'加班 → 承诺 → 通知'}
        ],
        explanation:'先识别，再评估，最后按角色与授权执行。'
      }
    ])
  };

  activities['process-reflection-01']={
    ...JSON.parse(JSON.stringify(activities[nodeActivityIds.processExplain[0]])),
    id:'process-reflection-01'
  };
  nodeActivityIds.processMixed=[
    ...nodeActivityIds.processOrder.slice(0,4),
    'process-reflection-01'
  ];

  const fixedActivityCache=new Map();
  function fixedActivityIds(activityKey,count){
    const source=Array.isArray(nodeActivityIds[activityKey])?nodeActivityIds[activityKey]:[];
    const target=Math.max(1,Number(count)||source.length||1);
    const cacheKey=activityKey+':'+target;
    if(fixedActivityCache.has(cacheKey))return fixedActivityCache.get(cacheKey);
    const result=source.slice(0,target);
    let index=0;
    while(result.length<target&&source.length){
      const sourceId=source[index%source.length];
      const cloneId=sourceId+'-fixed-'+String(result.length+1).padStart(2,'0');
      if(!activities[cloneId]){
        activities[cloneId]=JSON.parse(JSON.stringify(activities[sourceId]));
        activities[cloneId].id=cloneId;
        activities[cloneId].repeatOf=sourceId;
      }
      result.push(cloneId);
      index+=1;
    }
    fixedActivityCache.set(cacheKey,result);
    return result;
  }

  const nodeTemplates=[
    {baseId:'awareness-keywords',nodeType:'keyword',iconKey:'keyword',title:'环境线索',subtitle:'找出决定方法环境的词',activityKey:'environmentKeywords',activityCount:5},
    {baseId:'awareness-terms',nodeType:'choice',iconKey:'choice',title:'环境识别练习',subtitle:'判断敏捷、预测型与混合环境',activityKey:'environmentPractice',activityCount:6},
    {baseId:'understanding-roles',nodeType:'matching',iconKey:'matching',title:'角色职责配对',subtitle:'明确谁负责什么',activityKey:'roleMatching',activityCount:5},
    {baseId:'understanding-process',nodeType:'open_text',iconKey:'open_text',title:'处理顺序表达',subtitle:'4 道选择＋1 道简答，提交后查看参考答案',activityKey:'processMixed'},
    {baseId:'analysis-structure',nodeType:'keyword',iconKey:'keyword',title:'题干结构图',subtitle:'找出冲突与约束',activityKey:'structureKeywords',activityCount:7},
    {baseId:'analysis-traps',nodeType:'choice',iconKey:'choice',title:'选项陷阱',subtitle:'排除常见错误思路',activityKey:'trapPractice',activityCount:6},
    {baseId:'application-deep-recall',nodeType:'deep_recall',runMode:'composite',iconKey:'deep_recall',title:'深度回忆',subtitle:'从线索、知识到推理路径',activityKey:'deepRecall'},
    {baseId:'application-recall',nodeType:'memory_match',iconKey:'memory_match',title:'翻牌记忆',subtitle:'翻牌建立概念与职责配对',activityKey:'activeRecall'},
    {baseId:'integration-compare',nodeType:'choice',iconKey:'choice',title:'混合环境判断',subtitle:'同时识别两类治理机制',activityKey:'hybridPractice',activityCount:7},
    {baseId:'integration-rule',nodeType:'knowledge_graph',runMode:'composite',iconKey:'knowledge_graph',title:'知识图谱',subtitle:'补全知识点、选择关系并识别错误连接',activityKey:'knowledgeGraph'},
    {baseId:'application-induction',nodeType:'multi_question_induction',runMode:'composite',iconKey:'multi_question_induction',title:'多题归纳',subtitle:'完成原题、分类并排列通用规则',activityKey:'multiQuestionInduction'},
    {baseId:'integration-challenge',nodeType:'part_challenge',runMode:'challenge',iconKey:'challenge',title:'部分综合挑战',subtitle:'混合题型全部答对后完成本部分',estimatedMinutes:8,isChallenge:true}
  ];

  const stageBlueprints=[
    {
      id:'foundation',order:1,title:'基础认知',shortTitle:'基础认知',goal:null,
      description:'识别方法环境，理解角色和基本处理顺序。',
      parts:[
        {id:'environment',order:1,title:'识别方法环境',objective:'从角色、工件和节奏线索判断敏捷、预测型或混合环境。'},
        {id:'roles-process',order:2,title:'理解角色与顺序',objective:'明确角色职责和变更处理的第一步。'},
        {id:'foundation-practice',order:3,title:'基础情境巩固',objective:'通过重复练习巩固环境、角色和处理顺序。'}
      ]
    },
    {
      id:'reasoning',order:2,title:'分析与应用',shortTitle:'分析应用',
      goal:'能够拆解题干约束，排除常见陷阱，并在敏捷场景中处理变更。',
      description:'从题干线索走向情境判断。',
      parts:[
        {id:'question-analysis',order:1,title:'拆解题干与约束',objective:'识别题目中的方法环境、角色和关键约束。'},
        {id:'agile-application',order:2,title:'排除选项陷阱',objective:'排除自动接受、自动拒绝和命令控制类错误选项。'},
        {id:'reasoning-practice',order:3,title:'情境应用练习',objective:'在完整情境中运用价值、容量与角色判断。'}
      ]
    },
    {
      id:'transfer',order:3,title:'迁移与整合',shortTitle:'迁移整合',
      goal:'能够在敏捷、预测型与混合环境中选择正确的变更处理路径。',
      description:'形成跨情境可复用的判断规则。',
      parts:[
        {id:'hybrid-governance',order:1,title:'识别混合治理边界',objective:'同时处理敏捷价值排序和正式基准约束。'},
        {id:'integrated-rule',order:2,title:'形成综合判断主线',objective:'把环境、角色、约束和流程连接成可迁移规则。'},
        {id:'transfer-practice',order:3,title:'迁移与阶段挑战',objective:'通过综合练习和挑战检验跨情境迁移能力。'}
      ]
    }
  ];

  const stages=stageBlueprints.map(({parts,...stage})=>stage);
  const parts=stageBlueprints.flatMap(stage=>stage.parts.map(part=>({...part,stageId:stage.id})));
  const practiceEntryTemplates=Object.freeze([
    Object.freeze({id:'deep-recall-playground',type:'deep_recall',title:'深度回忆寻宝',description:'进入完整版，自由点击关键词并探索知识联想网络。',target:'knowledge-recall.html',image:'assets/practice-deep-recall.gif',stillImage:'assets/practice-deep-recall.png',afterNodeOrder:3,targetNodeOrder:4,searchRadius:1}),
    Object.freeze({id:'multi-question-playground',type:'multi_question_canvas',title:'多题归纳画布',description:'进入完整版，自由拖入多道原题、框选、分组和归纳。',target:'question-workspace.html',image:'assets/practice-multi-canvas.gif',stillImage:'assets/practice-multi-canvas.png',afterNodeOrder:8,targetNodeOrder:9,searchRadius:1})
  ]);
  parts.forEach(part=>{
    part.practiceEntries=practiceEntryTemplates.map(template=>({...template,id:part.id+'-'+template.id}));
  });
  const nodes=[];
  parts.forEach((part,partIndex)=>{
    nodeTemplates.forEach((template,nodeIndex)=>{
      const useLegacyId=partIndex===0;
      nodes.push({
        id:useLegacyId?template.baseId:(part.id+'-'+template.baseId),
        partId:part.id,
        order:nodeIndex+1,
        nodeType:template.nodeType,
        runMode:template.runMode||'standard',
        iconKey:template.iconKey||template.nodeType,
        title:template.title,
        subtitle:template.subtitle,
        estimatedMinutes:Number(template.estimatedMinutes||6),
        isChallenge:Boolean(template.isChallenge),
        activityIds:template.isChallenge?[]:(template.activityCount?fixedActivityIds(template.activityKey,template.activityCount):nodeActivityIds[template.activityKey])
      });
    });
  });

  function uniqueActivityIds(ids){
    const seen=new Set();
    return (ids||[]).filter(id=>{
      const key=String(id||'');
      if(!key||seen.has(key)||!activities[key])return false;
      seen.add(key);
      return true;
    });
  }
  function activitiesOfType(sourceNodes,type){
    return uniqueActivityIds(sourceNodes.flatMap(node=>node.activityIds||[]))
      .filter(id=>String(activities[id]?.type||'')===String(type));
  }
  const challengeCompositeTypes=['deep_recall','multi_question_induction','knowledge_graph'];
  parts.forEach((part,partIndex)=>{
    const partNodes=nodes.filter(node=>node.partId===part.id).sort((a,b)=>a.order-b.order);
    const challengeNode=partNodes.find(node=>node.isChallenge);
    const sourceNodes=partNodes.filter(node=>!node.isChallenge);
    if(!challengeNode)return;
    const preferredComposite=challengeCompositeTypes[partIndex%challengeCompositeTypes.length];
    const selected=[
      ...activitiesOfType(sourceNodes,'choice').slice(0,4),
      ...activitiesOfType(sourceNodes,'keyword').slice(0,1),
      ...activitiesOfType(sourceNodes,'matching').slice(0,1),
      ...activitiesOfType(sourceNodes,'open_text').slice(0,1),
      ...activitiesOfType(sourceNodes,preferredComposite).slice(0,1)
    ];
    const fallback=uniqueActivityIds(sourceNodes.flatMap(node=>node.activityIds||[]));
    challengeNode.activityIds=uniqueActivityIds([...selected,...fallback]).slice(0,8);
    challengeNode.challengeConfig={
      schemaVersion:1,
      partId:part.id,
      selectionMode:'fixed',
      sourceNodeIds:sourceNodes.map(node=>node.id),
      activityIds:[...challengeNode.activityIds],
      requiredFinalCorrect:true,
      showTypePerformance:true,
      expectedActivityCount:8,
      preferredCompositeType:preferredComposite
    };
  });

  function rotateIds(ids,offset){
    if(!ids.length)return [];
    const start=((Number(offset)||0)%ids.length+ids.length)%ids.length;
    return [...ids.slice(start),...ids.slice(0,start)];
  }
  const placementTests={};
  parts.forEach((part,partIndex)=>{
    const partNodes=nodes.filter(node=>node.partId===part.id).sort((a,b)=>a.order-b.order);
    const sourceNodes=partNodes.filter(node=>!node.isChallenge);
    const firstNode=sourceNodes[0]||null;
    const choices=rotateIds(activitiesOfType(sourceNodes,'choice'),partIndex*3).slice(0,10);
    const keywords=rotateIds(activitiesOfType(sourceNodes,'keyword'),partIndex).slice(0,1);
    const matching=rotateIds(activitiesOfType(sourceNodes,'matching'),partIndex).slice(0,1);
    const activityIds=uniqueActivityIds([...choices,...keywords,...matching]);
    if(activityIds.length!==12)throw new Error('Placement test requires 12 objective activities for '+part.id);
    const testId=part.id+'-placement-test';
    placementTests[part.id]={
      id:testId,
      schemaVersion:1,
      partId:part.id,
      stageId:part.stageId,
      title:part.title+'跳级测试',
      description:'完成 12 项代表性客观任务，达到 10 项正确即可跳过本部分。',
      selectionMode:'fixed',
      sourceNodeIds:sourceNodes.map(node=>node.id),
      activityIds,
      expectedActivityCount:12,
      requiredCorrect:10,
      passPercent:80,
      estimatedMinutes:10,
      allowedTypes:['choice','keyword','matching']
    };
    if(firstNode){
      firstNode.allowsPlacementTest=true;
      firstNode.placementTestId=testId;
    }
  });

  const activitySchema=global.KGActivitySchemaV1||null;
  const activityLibrary=activitySchema?.migrateLibrary?.(activities)||clone(activities);
  const activityLibraryValidation=activitySchema?.validateLibrary?.(activityLibrary)||{valid:true,activityCount:Object.keys(activityLibrary).length,errors:[],warnings:[]};

  const course={
    id:'pmp-change-response-demo-v3',
    title:'PMP 变更与敏捷响应',
    subtitle:'通过阶段、部分和短节点，建立可迁移的变更判断主线',
    subject:'PMP',
    version:13,
    schemaVersion:1,
    activitySchemaVersion:1,
    questionLanguageModes:['zh','bilingual'],
    assessmentLanguage:'zh',
    stages,
    parts,
    nodes,
    activities:activityLibrary,
    placementTests
  };

  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function orderedParts(stageId){return course.parts.filter(part=>part.stageId===stageId).sort((a,b)=>a.order-b.order)}
  function orderedNodes(){
    const stageOrder=new Map(course.stages.map(stage=>[stage.id,stage.order]));
    const partOrder=new Map(course.parts.map(part=>[part.id,{stage:stageOrder.get(part.stageId)||0,part:part.order}]));
    return [...course.nodes].sort((a,b)=>{
      const left=partOrder.get(a.partId)||{stage:0,part:0};
      const right=partOrder.get(b.partId)||{stage:0,part:0};
      return left.stage-right.stage||left.part-right.part||a.order-b.order;
    });
  }
  function getCourse(courseId=''){
    if(courseId&&String(courseId)!==course.id)return null;
    const result=clone(course);result.nodes=clone(orderedNodes());return result;
  }
  function nodeById(nodeId){return clone(course.nodes.find(node=>String(node.id)===String(nodeId||''))||null)}
  function partById(partId){return clone(course.parts.find(part=>String(part.id)===String(partId||''))||null)}
  function stageById(stageId){return clone(course.stages.find(stage=>String(stage.id)===String(stageId||''))||null)}
  function languageMode(mode){return activitySchema?.normalizeLanguageMode?.(mode||activitySchema.getLanguageMode?.()||'zh')||'zh'}
  function runtimeActivityById(activityId,mode){
    const id=String(activityId||'');
    const canonical=activityLibrary[id];
    if(canonical&&activitySchema?.materialize)return activitySchema.materialize(canonical,languageMode(mode));
    return clone(activities[id]||null);
  }
  function activitySchemaById(activityId){return clone(activityLibrary[String(activityId||'')]||null)}
  function getActivityLibrary(){return clone(activityLibrary)}
  function activitiesForNode(nodeId,mode){
    const node=course.nodes.find(item=>String(item.id)===String(nodeId||''));
    if(!node)return [];
    return (node.activityIds||[]).map(id=>runtimeActivityById(id,mode)).filter(Boolean);
  }
  function placementTestForPart(partId,mode){
    const config=course.placementTests?.[String(partId||'')];
    if(!config)return null;
    return clone({
      ...config,
      languageMode:languageMode(mode),
      activities:(config.activityIds||[]).map(id=>runtimeActivityById(id,mode)).filter(Boolean)
    });
  }
  function placementTestById(testId,mode){
    const config=Object.values(course.placementTests||{}).find(item=>String(item.id)===String(testId||''));
    return config?placementTestForPart(config.partId,mode):null;
  }
  function contentForNode(nodeId,mode){
    const node=course.nodes.find(item=>String(item.id)===String(nodeId||''));
    if(!node)return null;
    const resolvedMode=languageMode(mode);
    const nodeActivities=(node.activityIds||[]).map(id=>runtimeActivityById(id,resolvedMode)).filter(Boolean);
    return clone({
      mode:node.runMode||'standard',
      languageMode:resolvedMode,
      nodeId:node.id,
      activityType:node.nodeType,
      challengeConfig:node.challengeConfig||null,
      activities:nodeActivities,
      stages:nodeActivities[0]?.type==='deep_recall'?['clue','concept','reasoning']:(nodeActivities[0]?.type==='multi_question_induction'?['questions','classification','ordering']:(nodeActivities[0]?.type==='knowledge_graph'?['missing','relation','error']:[]))
    });
  }
  function nodesForPart(partId){return clone(course.nodes.filter(node=>node.partId===partId).sort((a,b)=>a.order-b.order))}
  function nodesForStage(stageId){
    const partIds=new Set(orderedParts(stageId).map(part=>part.id));
    return clone(orderedNodes().filter(node=>partIds.has(node.partId)));
  }

  global.KGGuidedLearningData=Object.freeze({
    version:13,
    activitySchemaVersion:1,
    getCourse,
    nodeById,
    partById,
    stageById,
    activitySchemaById,
    getActivityLibrary,
    activityById:runtimeActivityById,
    activitiesForNode,
    placementTestForPart,
    placementTestById,
    contentForNode,
    nodesForPart,
    nodesForStage,
    getLanguageMode:()=>languageMode(),
    setLanguageMode:mode=>activitySchema?.setLanguageMode?.(mode)||languageMode(mode),
    validateActivity:activity=>activitySchema?.validate?.(activity)||{valid:true,errors:[],warnings:[]},
    validateActivityLibrary:()=>clone(activityLibraryValidation),
    exportActivityPackage:metadata=>activitySchema?.createPackage?.(activityLibrary,metadata)||null,
    validateActivityPackage:payload=>activitySchema?.validatePackage?.(payload)||{valid:false,errors:['Activity Schema v1 未加载。']},
    analyzeActivityPackage:payload=>activitySchema?.analyzePackageMerge?.(activityLibrary,payload)||{valid:false,errors:['Activity Schema v1 未加载。']},
    mergeActivityPackage:(payload,options)=>activitySchema?.mergePackage?.(activityLibrary,payload,options)||{valid:false,errors:['Activity Schema v1 未加载。'],library:clone(activityLibrary)}
  });
})(window);
