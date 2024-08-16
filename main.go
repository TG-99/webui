package main
import (
        "fmt"
        "sync"
        "os/exec"
        "os"
)
//FUNC Ttyd
func ttyd() {
        cmd := exec.Command("bash", "./script/ttyd.sh")
        cmd.Run()
}
//FUNC VS
func vs() {
        cmd := exec.Command("bash", "./script/vs.sh")
        cmd.Run()
}
//FUNC FB
func fb() {
        cmd := exec.Command("bash", "./script/fb.sh")
        cmd.Run()
}
//FUNC Web
func web() {
        cmd := exec.Command("bash", "./script/web.sh")
        cmd.Run()
}
func main() {
        os.MkdirAll("./script", os.ModePerm)
        var wg sync.WaitGroup
        wg.Add( 4 )
        go vs()
        go ttyd()
        go fb()
        go web()
        wg.Wait()
        fmt.Printf( "All process Dead.\n" )
}
