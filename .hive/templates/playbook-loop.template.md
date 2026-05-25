# Loop Playbook Brief

> 用于 worker / verifier 循环：重复执行一组有界动作，直到具体 verifier 通过或达到停止条件。

## 目标

- 原 dispatch / milestone：
- 原始任务语义：调研 / investigate / 实现 / fix / review / test / other
- **硬规则：保任务语义。调研 / investigate 不得在 loop 中悄悄变成修复 / fix；review 不得变成实现。**

## Verifier（具体命令或检查）

- 命令 / 检查：
- 通过判据：
- 失败判据：

## 停止条件

- max iterations：
- 成功判据：
- 达到上限后的处理：

## 每轮动作

1. 运行 verifier
2. 根据失败输出做最小修正 / 等待 / 收集证据
3. 记录本轮结果
4. 再次运行 verifier

## 失败如何上报

- 最后一次 verifier 输出：
- 已尝试的轮次：
- 剩余风险 / 阻塞：
- 需要 user / PM 拍板的问题：
