// 静态注册表；只声明现有三种类型，不加载外部插件。
// type / modes / channel：类型名、可承担的任务（续接沿用原任务）和显示用接入方式。
// validate(agent, key, check, text)：配置加载经 validateAgent 调用，检查本类型字段，无返回值，错误沿用 check 的提示。
// status(agent)：config 调用，返回 agents_status 的模型覆盖和本类型额外字段。
// check(name, agent)：check 调用，返回该协作方的检查结果对象（可为 Promise）。
// execute(task)：任务命令调用；task 含 mode、kind、配置、模型、强度、目录、说明、续接信息和原参数；
//   适配器准备请求并借助运行器完成登记、执行、结果落盘和打印，返回 Promise<result>。
// validateResume(parent)：需要工具会话的适配器提供，resume 在读说明前调用，无返回值，缺会话时原样报错。
// locate(agent) / stats(sessionId, startedAt)：仅 Codex 提供；config 取得 { file, pre }，status 只读会话统计（对象或 null）。
// validateAgent 是传给配置模块的字段校验函数；CLI 的 schema 校验在此注入，避免适配器互相依赖。
import codex from './codex-cli.mjs';
import opencode from './opencode-cli.mjs';
import api, { validateSchema } from './api.mjs';

export const adapters = {
  [codex.type]: { ...codex, execute: (task) => codex.execute(task, validateSchema) },
  [api.type]: api,
  [opencode.type]: { ...opencode, execute: (task) => opencode.execute(task, validateSchema) },
};

export const validateAgent = (agent, key, check, text) => adapters[agent.type].validate(agent, key, check, text);
