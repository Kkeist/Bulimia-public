/**
 * Persona管理器
 * 管理用户自定义的角色设定
 */

const PersonaManager = {
    // 所有Persona
    personas: [],
    
    // 当前Persona
    current: null,
    
    /**
     * 初始化
     */
    init() {
        this.personas = Storage.getPersonas() || [];
        const currentPersona = Storage.getCurrentPersona();
        if (currentPersona) {
            this.current = typeof currentPersona === 'string' 
                ? this.personas.find(p => p.id === currentPersona) || null
                : currentPersona;
        }
    },
    
    /**
     * 创建Persona
     * @param {Object} data - Persona数据
     */
    create(data) {
        const persona = {
            id: Date.now().toString(),
            name: data.name || I18n.t('未命名'),
            content: data.content || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        this.personas.push(persona);
        this._save();
        
        return persona;
    },
    
    /**
     * 更新Persona
     * @param {string} id - Persona ID
     * @param {Object} data - 更新数据
     */
    update(id, data) {
        const persona = this.personas.find(p => p.id === id);
        if (persona) {
            Object.assign(persona, data, {
                updatedAt: new Date().toISOString()
            });
            this._save();
        }
    },
    
    /**
     * 删除Persona
     * @param {string} id - Persona ID
     */
    delete(id) {
        this.personas = this.personas.filter(p => p.id !== id);
        if (this.current?.id === id) {
            this.current = null;
            // 同步清掉 Storage 里挂着的死 ID，否则 init 时拿到死 ID（find 返回 undefined 兜底成 null），
            // 字段在 settings 里永远残留
            Storage.deleteSettingsKey('currentPersona');
        }
        this._save();
    },
    
    /** 把删掉的设定放回去；列表里已有同一个设定时不覆盖，返回 false */
    restore(persona) {
        if (this.personas.some(p => p.id === persona.id)) return false;
        this.personas.push(persona);
        this._save();
        return true;
    },

    /**
     * 设置当前Persona
     * @param {string} id - Persona ID
     */
    setCurrent(id) {
        this.current = this.personas.find(p => p.id === id) || null;
        Storage.setCurrentPersona(id);
    },
    
    /**
     * 获取当前Persona内容
     */
    getCurrentContent() {
        return this.current?.content || '';
    },
    
    /**
     * 获取所有Persona
     */
    getAll() {
        return [...this.personas];
    },
    
    /**
     * 保存
     */
    _save() {
        Storage.savePersonas(this.personas);
    }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PersonaManager };
}
if (typeof window !== 'undefined') window.PersonaManager = PersonaManager;
