package main
import (
        "fmt"
        "sync"
        "os/exec"
        "os"
)
//FUNC Ttyd
func ttyd() {
        cmd := exec.Command("bash", "./script/ttyd.sh", "2>", "ttyd.log")
        cmd.Run()
}
//FUNC VS
func vs() {
        cmd := exec.Command("bash", "./script/vs.sh", "2>", "vs.log")
        cmd.Run()
}
//FUNC alist
func alist() {
        cmd := exec.Command("bash", "./script/alist.sh", "2>", "alist.log")
        cmd.Run()
}
//FUNC FB
func fb() {
        cmd := exec.Command("bash", "./script/fb.sh", "2>", "fb.log")
        cmd.Run()
}
//FUNC Web
func web() {
        cmd := exec.Command("bash", "./script/web.sh", "2>", "web.log")
        cmd.Run()
}
func main() {
        os.MkdirAll("./script", os.ModePerm)
        var wg sync.WaitGroup
        wg.Add( 5 )
        go vs()
        go alist()
        go ttyd()
        go fb()
        go web()
        wg.Wait()
        fmt.Printf( "All process Dead.\n" )
}
