/**
 * Test Runner - 测试运行器
 * Executes module tests based on TEST_SPECIFICATION.md
 */

class TestRunner {
    constructor(systems) {
        this.timeSystem = systems.timeSystem;
        this.variableSystem = systems.variableSystem;
        this.moduleSystem = systems.moduleSystem;
        this.summarySystem = systems.summarySystem;
        this.promptGenerator = systems.promptGenerator;
        this.tagParser = systems.tagParser;

        this.currentTest = null;
        this.testResults = [];
        this.lastGeneratedPrompt = '';
    }

    /**
     * Run all tests from a test configuration
     */
    async runTests(testConfig) {
        console.log(`[TestRunner] Starting tests: ${testConfig.testName}`);

        const startTime = Date.now();
        const results = {
            testName: testConfig.testName,
            moduleId: testConfig.moduleId,
            description: testConfig.description,
            status: 'passed',
            totalTests: testConfig.tests.length,
            passedTests: 0,
            failedTests: 0,
            duration: 0,
            results: []
        };

        for (const test of testConfig.tests) {
            const testResult = await this.runSingleTest(test);
            results.results.push(testResult);

            if (testResult.status === 'passed') {
                results.passedTests++;
            } else {
                results.failedTests++;
                results.status = 'failed';
            }
        }

        results.duration = Date.now() - startTime;
        this.testResults.push(results);

        return results;
    }

    /**
     * Run a single test scenario
     */
    async runSingleTest(test) {
        console.log(`[TestRunner] Running test: ${test.name}`);

        const result = {
            testName: test.name,
            status: 'passed',
            steps: []
        };

        for (let i = 0; i < test.steps.length; i++) {
            try {
                const stepResult = await this.runStep(test.steps[i], i);
                result.steps.push(stepResult);

                if (stepResult.status !== 'passed') {
                    result.status = 'failed';
                    break; // Stop on first failure
                }
            } catch (error) {
                result.status = 'error';
                result.error = error.message;
                result.steps.push({
                    stepIndex: i,
                    status: 'error',
                    error: error.message
                });
                break;
            }
        }

        return result;
    }

    /**
     * Run a single step
     */
    async runStep(step, stepIndex) {
        const result = {
            stepIndex: stepIndex,
            type: step.type,
            description: step.description,
            status: 'passed',
            assertions: []
        };

        try {
            // Execute the action
            await this.executeAction(step.type, step.action);

            // Check assertions
            if (step.assertions) {
                for (const assertion of step.assertions) {
                    const assertResult = this.checkAssertion(assertion);
                    result.assertions.push(assertResult);

                    if (!assertResult.passed) {
                        result.status = 'failed';
                    }
                }
            }
        } catch (error) {
            result.status = 'error';
            result.error = error.message;
        }

        return result;
    }

    /**
     * Execute an action
     */
    async executeAction(type, action) {
        switch (type) {
            case 'execute_tag':
                return await this.executeTag(action.tag);

            case 'enter_module':
                return this.enterModule(action.moduleId);

            case 'generate_prompt':
                return this.generatePrompt();

            case 'advance_time':
                return this.advanceTime(action);

            case 'wait':
                return this.wait(action.ms);

            default:
                throw new Error(`Unknown action type: ${type}`);
        }
    }

    /**
     * Execute AI tag
     */
    async executeTag(tagString) {
        const parsed = this.tagParser.parseMessage(tagString);
        const results = await this.tagParser.executeTags(parsed.tags);
        return results;
    }

    /**
     * Enter a module
     */
    enterModule(moduleId) {
        this.moduleSystem.enterModule(moduleId);
        this.moduleSystem.currentModule = this.moduleSystem.getModule(moduleId);
        return { moduleId, state: 'entered' };
    }

    /**
     * Generate prompt
     */
    generatePrompt() {
        const currentModuleId = this.moduleSystem.currentModule?.id;
        if (!currentModuleId) {
            throw new Error('No current module');
        }

        this.lastGeneratedPrompt = this.promptGenerator.generatePrompt(currentModuleId);
        return this.lastGeneratedPrompt;
    }

    /**
     * Advance time
     */
    advanceTime(action) {
        const { parameterId, operation, value } = action;

        // 获取当前值
        const param = this.timeSystem.getParameter(parameterId);
        if (!param) {
            throw new Error(`时间参数${parameterId}不存在`);
        }

        const currentValue = param.calculate(this.timeSystem.systemValues);
        let newValue = currentValue;

        if (operation === 'add') {
            newValue = currentValue + value;
        } else if (operation === 'set') {
            newValue = value;
        }

        this.timeSystem.advanceTime({ [parameterId]: newValue });
        return this.timeSystem.getCurrentTime();
    }

    /**
     * Wait
     */
    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check an assertion
     */
    checkAssertion(assertion) {
        const result = {
            type: assertion.type,
            passed: false,
            expected: assertion.expected,
            actual: null
        };

        try {
            switch (assertion.type) {
                case 'variable_value':
                    result.actual = this.variableSystem.getValue(assertion.variableId);
                    const operator = assertion.operator || '==';
                    result.passed = this.compareValues(result.actual, operator, assertion.expected);
                    break;

                case 'module_state':
                    const module = this.moduleSystem.getModule(assertion.moduleId);
                    result.actual = module?.state;
                    result.passed = result.actual === assertion.expected;
                    break;

                case 'prompt_contains':
                    result.actual = this.lastGeneratedPrompt.includes(assertion.text);
                    result.passed = result.actual;
                    break;

                case 'prompt_segment_exists':
                    const segmentMarker = `\`\`\`${assertion.segment}`;
                    result.actual = this.lastGeneratedPrompt.includes(segmentMarker);
                    result.passed = result.actual;
                    break;

                case 'time_value':
                    const param = this.timeSystem.getParameter(assertion.parameterId);
                    if (param) {
                        result.actual = param.calculate(this.timeSystem.systemValues);
                        result.passed = result.actual === assertion.expected;
                    }
                    break;

                case 'delivery_done':
                    const currentModule = this.moduleSystem.currentModule;
                    if (currentModule && currentModule.deliveryInfo) {
                        const delivery = currentModule.deliveryInfo.find(d => d.title === assertion.title);
                        result.actual = delivery?.done || false;
                        result.passed = result.actual === assertion.expected;
                    }
                    break;

                case 'variable_visible':
                    result.actual = this.variableSystem.isVariableVisibleInModule(
                        assertion.variableId,
                        assertion.moduleId
                    );
                    result.passed = result.actual === assertion.expected;
                    break;

                default:
                    result.passed = false;
                    result.error = `Unknown assertion type: ${assertion.type}`;
            }
        } catch (error) {
            result.passed = false;
            result.error = error.message;
        }

        return result;
    }

    /**
     * Compare values with operator
     */
    compareValues(actual, operator, expected) {
        switch (operator) {
            case '==': return actual === expected;
            case '!=': return actual !== expected;
            case '>': return actual > expected;
            case '>=': return actual >= expected;
            case '<': return actual < expected;
            case '<=': return actual <= expected;
            default: return false;
        }
    }

    /**
     * Format test results as HTML
     */
    formatResultsHTML(results) {
        let html = `<div class="test-results">`;
        html += `<div class="test-header ${results.status}">`;
        html += `<strong>${results.testName}</strong> - ${results.status.toUpperCase()}<br>`;
        html += `通过: ${results.passedTests}/${results.totalTests} | 用时: ${results.duration}ms`;
        html += `</div>\n\n`;

        for (const testResult of results.results) {
            html += `<div class="test-case ${testResult.status}">`;
            html += `  <strong>${testResult.testName}</strong>: ${testResult.status}\n`;

            if (testResult.error) {
                html += `  错误: ${testResult.error}\n`;
            }

            for (const step of testResult.steps) {
                const icon = step.status === 'passed' ? '✅' : '❌';
                html += `  ${icon} Step ${step.stepIndex + 1}: ${step.description}\n`;

                if (step.assertions) {
                    for (const assertion of step.assertions) {
                        const assertIcon = assertion.passed ? '  ✓' : '  ✗';
                        html += `    ${assertIcon} ${assertion.type}: `;
                        if (assertion.passed) {
                            html += `PASS\n`;
                        } else {
                            html += `FAIL (expected: ${JSON.stringify(assertion.expected)}, actual: ${JSON.stringify(assertion.actual)})`;
                            if (assertion.error) html += ` - ${assertion.error}`;
                            html += `\n`;
                        }
                    }
                }
            }

            html += `</div>\n`;
        }

        html += `</div>`;
        return html;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TestRunner };
}
