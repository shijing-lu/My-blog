import { useState } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { MaterialIcon } from './MaterialIcon';

/** Real shared controls for visual/accessibility acceptance; all state stays local. */
export default function MaterialComponentDemo() {
  const [selection, setSelection] = useState('reading');
  const [feedback, setFeedback] = useState('示例操作不会写入业务数据。');
  return <section className="mt-8" data-material-component-demo>
    <h2 className="mb-4 text-2xl font-medium">共享组件示例</h2>
    <Card>
      <CardHeader><CardTitle>输入、选择与操作</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <label className="block max-w-md text-sm">示例输入<Input aria-label="共享示例输入" placeholder="可以输入，切换风格后仍保留" className="mt-2" /></label>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selection} onValueChange={setSelection}>
            <SelectTrigger aria-label="共享示例选择"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="reading">阅读</SelectItem>
              <SelectItem value="editing">编辑</SelectItem>
              <SelectItem value="schedule">日程</SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" aria-label="共享示例菜单"><MaterialIcon name="more_horiz" />更多操作</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setFeedback('已选择示例复制。')}><MaterialIcon name="content_copy" />示例复制</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFeedback('已选择示例下载。')}><MaterialIcon name="download" />示例下载</DropdownMenuItem>
              <DropdownMenuItem disabled>不可用操作</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog>
            <DialogTrigger asChild><Button>共享示例弹窗</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>共享组件确认</DialogTitle><DialogDescription>检查键盘焦点、关闭操作与两种风格的视觉状态。</DialogDescription></DialogHeader>
              <DialogFooter showCloseButton />
            </DialogContent>
          </Dialog>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setFeedback('已选择主要操作。')}>主要操作</Button>
          <Button variant="secondary" onClick={() => setFeedback('已选择次要操作。')}>次要操作</Button>
          <Button variant="outline" onClick={() => setFeedback('已选择描边操作。')}>描边操作</Button>
          <Button variant="ghost" onClick={() => setFeedback('已选择文字操作。')}>文字操作</Button>
          <Button disabled>禁用操作</Button>
        </div>
        <Tabs defaultValue="first">
          <TabsList aria-label="共享示例标签"><TabsTrigger value="first">第一项</TabsTrigger><TabsTrigger value="second">第二项</TabsTrigger></TabsList>
          <TabsContent value="first">标签页支持方向键切换。</TabsContent><TabsContent value="second">第二项内容。</TabsContent>
        </Tabs>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{feedback}</p>
      </CardContent>
    </Card>
  </section>;
}
